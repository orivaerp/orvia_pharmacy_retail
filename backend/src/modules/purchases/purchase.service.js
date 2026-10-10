import mongoose from 'mongoose';
import { applyReceipt, checkReceivable } from './order.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { Branch } from '../branches/branch.model.js';
import { Product, toView } from '../products/product.model.js';
import { Batch, StockLedger, endOfMonth } from '../stock/stock.model.js';
import { loadReceivableProducts, receiveBatch } from '../stock/stock.service.js';
import { Purchase, PurchaseReturn, Supplier, SupplierPayment, nextNumber } from './purchase.model.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const DAY = 24 * 60 * 60 * 1000;

/** The money of one invoice line. Billed packs are charged; free packs only add stock. */
export function priceLine({ packs, rate, discountPct = 0, gstPercent }) {
  const gross = r2(packs * rate);
  const discount = r2((gross * discountPct) / 100);
  const taxable = r2(gross - discount);
  const gst = r2((taxable * gstPercent) / 100);
  return { gross, discount, taxable, gst, total: r2(taxable + gst) };
}

// ---------------------------------------------------------------- suppliers

/** What the shop owes each supplier: opening balance + invoices - payments - returns. */
async function balances(supplierIds) {
  const match = { $match: { supplierId: { $in: supplierIds } } };
  const [bought, paid, returned] = await Promise.all([
    Purchase.aggregate([match, { $group: { _id: '$supplierId', total: { $sum: '$totals.grand' }, count: { $sum: 1 }, last: { $max: '$invoiceDate' } } }]),
    SupplierPayment.aggregate([match, { $group: { _id: '$supplierId', total: { $sum: '$amount' } } }]),
    PurchaseReturn.aggregate([match, { $group: { _id: '$supplierId', total: { $sum: '$total' } } }]),
  ]);
  const by = (rows) => new Map(rows.map((x) => [String(x._id), x]));
  return { bought: by(bought), paid: by(paid), returned: by(returned) };
}

export async function listSuppliers({ q, active }) {
  const filter = {};
  if (active === 'true') filter.isActive = true;
  if (q?.trim()) {
    const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { gstin: rx }, { contactPerson: rx }];
  }
  const suppliers = await Supplier.find(filter).sort({ isActive: -1, name: 1 }).lean();
  const b = await balances(suppliers.map((s) => s._id));
  return suppliers.map((s) => {
    const id = String(s._id);
    const outstanding = r2((s.openingBalance ?? 0) + (b.bought.get(id)?.total ?? 0) - (b.paid.get(id)?.total ?? 0) - (b.returned.get(id)?.total ?? 0));
    return { ...s, outstanding, invoices: b.bought.get(id)?.count ?? 0, lastInvoiceDate: b.bought.get(id)?.last ?? null };
  });
}

export async function createSupplier(data) {
  if (await Supplier.exists({ name: new RegExp(`^${data.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) {
    throw ApiError.conflict('A supplier with this name already exists');
  }
  return Supplier.create(data);
}

export async function updateSupplier(id, patch) {
  const s = await Supplier.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  if (!s) throw ApiError.notFound('Supplier not found');
  return s;
}

/** Supplier statement: every invoice, payment and return with a running balance. */
export async function supplierLedger(id) {
  const supplier = await Supplier.findById(id).lean();
  if (!supplier) throw ApiError.notFound('Supplier not found');
  const [purchases, payments, returns] = await Promise.all([
    Purchase.find({ supplierId: id }).select('number invoiceNo invoiceDate dueDate totals branchId').lean(),
    SupplierPayment.find({ supplierId: id }).lean(),
    PurchaseReturn.find({ supplierId: id }).select('number creditNoteNo returnedOn total reason').lean(),
  ]);
  const entries = [
    ...purchases.map((p) => ({ kind: 'PURCHASE', id: p._id, date: p.invoiceDate, ref: p.invoiceNo, number: p.number, dueDate: p.dueDate, amount: p.totals.grand })),
    ...payments.map((p) => ({ kind: 'PAYMENT', id: p._id, date: p.paidOn, ref: [p.mode, p.reference].filter(Boolean).join(' '), note: p.note, amount: -p.amount })),
    ...returns.map((r) => ({ kind: 'RETURN', id: r._id, date: r.returnedOn, ref: r.creditNoteNo || r.number, number: r.number, note: r.reason, amount: -r.total })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = supplier.openingBalance ?? 0;
  for (const e of entries) {
    running = r2(running + e.amount);
    e.balance = running;
  }
  return { supplier, openingBalance: supplier.openingBalance ?? 0, outstanding: running, entries: entries.reverse() };
}

export async function recordPayment(userId, supplierId, input) {
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw ApiError.notFound('Supplier not found');
  return SupplierPayment.create({ supplierId, amount: r2(input.amount), paidOn: input.paidOn, mode: input.mode, reference: input.reference, note: input.note, branchId: input.branchId, createdBy: userId });
}

// ---------------------------------------------------------------- purchases

/**
 * Books a supplier invoice and receives its stock in one transaction.
 * Every line becomes (or tops up) a batch in the chosen outlet; free packs add stock without being billed.
 */
export async function createPurchase(user, input) {
  const [branch, supplier] = await Promise.all([Branch.findById(input.branchId), Supplier.findById(input.supplierId)]);
  if (!branch?.isActive) throw ApiError.badRequest('Choose an active outlet');
  if (!supplier || !supplier.isActive) throw ApiError.badRequest('Choose an active supplier');
  const invoiceNo = input.invoiceNo.trim();
  if (await Purchase.exists({ supplierId: supplier._id, invoiceNo: new RegExp(`^${invoiceNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) {
    throw ApiError.conflict(`Invoice ${invoiceNo} from ${supplier.name} is already booked`);
  }

  // booked against a purchase order: it must be an open order of this supplier for this outlet
  const order = input.orderId ? await checkReceivable(input.orderId, { supplierId: supplier._id, branchId: branch._id }) : null;

  const products = await loadReceivableProducts(input.lines.map((l) => l.productId));
  const invoiceDate = new Date(`${input.invoiceDate}T00:00:00.000Z`);
  const dueDate = input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : new Date(invoiceDate.getTime() + (supplier.creditDays ?? 0) * DAY);

  const session = await mongoose.startSession();
  let purchase;
  try {
    await session.withTransaction(async () => {
      const lines = [];
      for (const line of input.lines) {
        const productDoc = products.get(line.productId);
        const gstPercent = line.gstPercent ?? toView(productDoc).gstPercent ?? 0;
        const money = priceLine({ packs: line.packs, rate: line.rate, discountPct: line.discountPct, gstPercent });
        const received = line.packs + (line.freePacks ?? 0);
        // what one received pack really cost (free packs spread the cost), before GST: this is the stock's purchase rate
        const costPerPack = received ? r2(money.taxable / received) : 0;
        const r = await receiveBatch(session, {
          userId: user.id,
          branchId: input.branchId,
          productDoc,
          batchNo: line.batchNo,
          expiry: line.expiry,
          mrp: line.mrp,
          purchaseRate: costPerPack,
          packs: received,
          type: 'PURCHASE',
          reference: invoiceNo,
          supplierName: supplier.name,
        });
        lines.push({
          productId: productDoc._id,
          batchId: r.batchId,
          name: r.name,
          batchNo: r.batchNo,
          expiryDate: endOfMonth(line.expiry),
          mrp: line.mrp,
          rate: line.rate,
          discountPct: line.discountPct ?? 0,
          gstPercent,
          packs: line.packs,
          freePacks: line.freePacks ?? 0,
          taxable: money.taxable,
          gst: money.gst,
          total: money.total,
          gross: money.gross,
          discount: money.discount,
        });
      }

      const sum = (k) => r2(lines.reduce((s, l) => s + l[k], 0));
      const exact = sum('total');
      const grand = Math.round(exact);
      const number = await nextNumber(session, 'purchase', 'PUR');
      [purchase] = await Purchase.create(
        [
          {
            number,
            branchId: branch._id,
            supplierId: supplier._id,
            supplierName: supplier.name,
            invoiceNo,
            invoiceDate,
            dueDate,
            lines: lines.map(({ gross, discount, ...keep }) => keep),
            totals: { gross: sum('gross'), discount: sum('discount'), taxable: sum('taxable'), gst: sum('gst'), roundOff: r2(grand - exact), grand },
            notes: input.notes,
            orderId: order?._id,
            orderNumber: order?.number,
            createdBy: user.id,
          },
        ],
        { session },
      );
      if (order) await applyReceipt(session, order._id, purchase._id, input.lines.map((l) => ({ productId: l.productId, packs: l.packs + (l.freePacks ?? 0) })));
    });
  } finally {
    await session.endSession();
  }
  return purchase;
}

export async function listPurchases({ supplierId, branchId, branchIds, q, from, to, page = 1, limit = 20 }) {
  const filter = {};
  if (supplierId) filter.supplierId = supplierId;
  if (branchId) filter.branchId = branchId;
  else if (branchIds?.length) filter.branchId = { $in: branchIds };
  if (q?.trim()) {
    const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ invoiceNo: rx }, { number: rx }, { supplierName: rx }];
  }
  if (from || to) filter.invoiceDate = { ...(from && { $gte: new Date(from) }), ...(to && { $lte: new Date(to) }) };
  const [items, total] = await Promise.all([
    Purchase.find(filter).select('-lines').populate('branchId', 'name').sort({ invoiceDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Purchase.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

export async function getPurchase(id) {
  const p = await Purchase.findById(id).populate('branchId', 'name code').populate('supplierId', 'name gstin phone').populate('createdBy', 'name').lean();
  if (!p) throw ApiError.notFound('Purchase not found');
  return p;
}

// ---------------------------------------------------------------- returns

/**
 * Sends stock back to a supplier. It leaves the outlet's stock and reduces what the shop owes.
 * The credit is worked out from the batch's own cost, plus GST at the product's rate.
 */
export async function createPurchaseReturn(user, input) {
  const [branch, supplier] = await Promise.all([Branch.findById(input.branchId), Supplier.findById(input.supplierId)]);
  if (!branch?.isActive) throw ApiError.badRequest('Choose an active outlet');
  if (!supplier) throw ApiError.badRequest('Choose a supplier');

  const session = await mongoose.startSession();
  let doc;
  try {
    await session.withTransaction(async () => {
      const lines = [];
      for (const line of input.lines) {
        const batch = await Batch.findOne({ _id: line.batchId, branchId: input.branchId }).session(session);
        if (!batch) throw ApiError.notFound('Batch not found in this outlet');
        const productDoc = await Product.findById(batch.productId).populate('masterId').session(session);
        const view = toView(productDoc);

        const units = line.packs * (batch.unitsPerPack || 1);
        const res = await Batch.updateOne({ _id: batch._id, quantity: { $gte: units } }, { $inc: { quantity: -units } }, { session });
        if (!res.matchedCount) {
          const have = Math.floor(batch.quantity / (batch.unitsPerPack || 1));
          throw ApiError.conflict(`Batch ${batch.batchNo} has only ${have} pack${have === 1 ? '' : 's'}, so ${line.packs} cannot be returned`);
        }

        const amount = r2(line.packs * batch.purchaseRate);
        const gst = r2((amount * (view.gstPercent ?? 0)) / 100);
        lines.push({ productId: batch.productId, batchId: batch._id, name: view.name, batchNo: batch.batchNo, packs: line.packs, rate: batch.purchaseRate, gstPercent: view.gstPercent ?? 0, amount, gst, total: r2(amount + gst) });

        await StockLedger.create(
          [{ type: 'PURCHASE_RETURN', productId: batch.productId, batchId: batch._id, branchId: batch.branchId, qty: -units, unitsPerPack: batch.unitsPerPack, purchaseRate: batch.purchaseRate, mrp: batch.mrp, reference: input.creditNoteNo, supplierName: supplier.name, note: input.reason, userId: user.id }],
          { session },
        );
      }
      const number = await nextNumber(session, 'purchase-return', 'PRN');
      [doc] = await PurchaseReturn.create(
        [
          {
            number,
            branchId: branch._id,
            supplierId: supplier._id,
            supplierName: supplier.name,
            purchaseId: input.purchaseId,
            creditNoteNo: input.creditNoteNo,
            returnedOn: new Date(`${input.returnedOn}T00:00:00.000Z`),
            reason: input.reason,
            lines,
            total: r2(lines.reduce((s, l) => s + l.total, 0)),
            createdBy: user.id,
          },
        ],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  return doc;
}

export async function listReturns({ supplierId, branchIds }) {
  return PurchaseReturn.find({ ...(supplierId && { supplierId }), ...(branchIds?.length && { branchId: { $in: branchIds } }) })
    .populate('branchId', 'name')
    .sort({ returnedOn: -1, createdAt: -1 })
    .limit(100)
    .lean();
}
