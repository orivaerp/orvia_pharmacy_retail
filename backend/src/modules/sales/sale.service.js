import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { Branch } from '../branches/branch.model.js';
import { Medicine } from '../medicines/medicine.model.js';
import { Product, toView } from '../products/product.model.js';
import { nextNumber } from '../purchases/purchase.model.js';
import { Batch, StockLedger } from '../stock/stock.model.js';
import { User } from '../users/user.model.js';
import { assertWithinLimit } from '../plans/plan.service.js';
import { Customer, normalizePhone } from '../customers/customer.model.js';
import { balanceOf } from '../customers/customer.service.js';
import { OnlinePayment } from '../payments/payment.model.js';
import { gatewayPayment, gatewayRemaining, sendRefund } from '../payments/refund.service.js';
import { Tenant } from '../tenants/tenant.model.js';
import { stateCodeOfGstin, stateCodeOfName } from '../../utils/gst.js';
import { Sale, SaleReturn } from './sale.model.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RX_SCHEDULES = ['H', 'H1'];

/** Prices one bill line. MRP already includes GST, so the tax is carved out of the price, never added on top. */
export function priceSaleLine({ units, unitsPerPack, mrp, discountPct = 0, gstPercent }) {
  const gross = r2((units * mrp) / unitsPerPack);
  const discount = r2((gross * discountPct) / 100);
  const total = r2(gross - discount);
  const taxable = r2(total / (1 + gstPercent / 100));
  return { gross, discount, taxable, gst: r2(total - taxable), total };
}

/** Products on sale in one outlet: matches name, composition or a scanned barcode; only items with unexpired stock. */
export async function searchForSale({ branchId, q, limit = 20, barcodes = true }) {
  const text = q?.trim();
  if (!text) return [];
  const rx = new RegExp(esc(text), 'i');
  const masterIds = (await Medicine.find({ $or: [{ name: rx }, { composition: rx }, ...(barcodes ? [{ barcodes: text }] : [])] }).limit(300).select('_id').lean()).map((m) => m._id);
  const products = await Product.find({ isActive: true, $or: [{ masterId: { $in: masterIds } }, { name: rx }, ...(barcodes ? [{ barcodes: text }] : [])] }).populate('masterId').limit(60);
  if (!products.length) return [];

  const batches = await Batch.find({
    branchId,
    quantity: { $gt: 0 },
    expiryDate: { $gte: new Date() },
    productId: { $in: products.map((p) => p._id) },
  })
    .sort({ expiryDate: 1 })
    .lean();
  const byProduct = new Map();
  for (const b of batches) {
    const key = String(b.productId);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(b);
  }

  return products
    .filter((p) => byProduct.has(String(p._id)))
    .map((p) => {
      const v = toView(p);
      const bs = byProduct.get(String(p._id));
      return {
        productId: p._id,
        name: v.name,
        composition: v.composition,
        manufacturer: v.manufacturer,
        schedule: v.schedule,
        gstPercent: v.gstPercent,
        unitsPerPack: v.unitsPerPack,
        looseSelling: v.looseSelling,
        barcodeMatch: barcodes && v.barcodes.includes(text),
        units: bs.reduce((s, b) => s + b.quantity, 0),
        mrp: bs[0].mrp,
        batches: bs.map((b) => ({ _id: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate, mrp: b.mrp, units: b.quantity })),
      };
    })
    .sort((a, b) => Number(b.barcodeMatch) - Number(a.barcodeMatch) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * Creates a bill. Every line is taken from stock in the same transaction (FEFO: earliest expiry first unless the
 * cashier picked a batch), so a bill can never exist without its stock movement.
 */
/** Who is selling and who is buying, for GST: B2B when the customer has a GSTIN; IGST when that customer is in another state. */
export function taxParty(branch, shopGstin, customer) {
  const sellerGstin = branch.gstin || shopGstin || undefined;
  const sellerState = stateCodeOfGstin(sellerGstin) ?? stateCodeOfName(branch.state);
  const buyerGstin = customer?.gstin || undefined;
  const buyerState = stateCodeOfGstin(buyerGstin);
  return {
    supplyType: buyerGstin ? 'B2B' : 'B2C',
    sellerGstin,
    buyerGstin,
    placeOfSupply: buyerState ?? sellerState,
    interState: Boolean(buyerState && sellerState && buyerState !== sellerState),
  };
}

export async function createSale(user, input) {
  await assertWithinLimit(user.tenantId, 'bills');
  const branch = await Branch.findById(input.branchId);
  if (!branch || !branch.isActive) throw ApiError.badRequest('Choose an active outlet');

  const seller = await User.findById(user.id).select('name').lean();
  const shopGstin = (await Tenant.findById(user.tenantId).select('gstin').lean())?.gstin;
  const ids = [...new Set(input.lines.map((l) => l.productId))];
  const products = await Product.find({ _id: { $in: ids } }).populate('masterId');
  const byId = new Map(products.map((p) => [String(p._id), toView(p)]));
  for (const l of input.lines) {
    const v = byId.get(l.productId);
    if (!v) throw ApiError.badRequest('One of the products no longer exists');
    if (!v.isActive) throw ApiError.badRequest(`"${v.name}" is inactive`);
    if (v.schedule === 'X' || v.schedule === 'NDPS') throw ApiError.badRequest(`"${v.name}" is a Schedule ${v.schedule} drug and cannot be sold from the standard counter`);
    if (l.loose && !v.looseSelling) throw ApiError.badRequest(`"${v.name}" is not set up for loose selling`);
  }

  const needsRx = input.lines.some((l) => RX_SCHEDULES.includes(byId.get(l.productId).schedule));
  const rx = input.prescriber;
  if (needsRx && !(rx?.doctorName?.trim() && rx?.patientName?.trim())) {
    throw ApiError.badRequest('This bill has Schedule H/H1 medicines. Enter the doctor and patient name.');
  }
  if (input.lines.some((l) => byId.get(l.productId).schedule === 'H1') && !rx?.regNo?.trim()) {
    throw ApiError.badRequest('Schedule H1 needs the doctor registration number.');
  }

  // who is buying: a chosen customer, or one found / created from the phone number. Udhaar needs one.
  const creditAmt = r2(input.payments.filter((p) => p.mode === 'CREDIT').reduce((t, p) => t + p.amount, 0));
  let customer = null;
  if (input.customerId) {
    customer = await Customer.findById(input.customerId);
    if (!customer || !customer.isActive) throw ApiError.badRequest('Choose an active customer.');
  } else {
    const phone = normalizePhone(input.customerPhone);
    if (input.customerPhone?.trim() && !phone) throw ApiError.badRequest('The phone number must have 10 digits.');
    if (phone) customer = await Customer.findOne({ phone });
    if (!customer && (phone || (creditAmt > 0 && input.customerName?.trim()))) {
      customer = await Customer.create({ name: input.customerName?.trim() || `Customer ${phone.slice(-4)}`, phone: phone || undefined, createdBy: user.id });
    }
  }
  if (creditAmt > 0) {
    if (!customer) throw ApiError.badRequest('Udhaar needs a customer. Pick one, or enter the name and phone number.');
    const owes = await balanceOf(customer._id);
    if (customer.creditLimit > 0 && owes + creditAmt > customer.creditLimit + 0.009) {
      throw ApiError.badRequest(`${customer.name} already owes ₹${owes} and the credit limit is ₹${customer.creditLimit}. This bill would take them over it.`);
    }
  }

  const session = await mongoose.startSession();
  let sale;
  try {
    await session.withTransaction(async () => {
      const billLines = [];
      const moves = [];
      for (const l of input.lines) {
        const v = byId.get(l.productId);
        const upp = v.unitsPerPack || 1;
        let need = l.packs * upp + (l.loose ?? 0);
        if (need < 1) throw ApiError.badRequest(`${v.name}: quantity must be at least 1`);

        const filter = { productId: l.productId, branchId: input.branchId, quantity: { $gt: 0 }, expiryDate: { $gte: new Date() } };
        if (l.batchId) filter._id = l.batchId;
        const batches = await Batch.find(filter).sort({ expiryDate: 1 }).session(session);
        const available = batches.reduce((s, b) => s + b.quantity, 0);
        if (available < need) {
          const packs = Math.floor(available / upp);
          throw ApiError.conflict(`${v.name}: only ${packs} pack${packs === 1 ? '' : 's'}${available % upp ? ` + ${available % upp} loose` : ''} in stock`);
        }

        for (const b of batches) {
          if (need <= 0) break;
          const take = Math.min(need, b.quantity);
          const res = await Batch.updateOne({ _id: b._id, quantity: { $gte: take } }, { $inc: { quantity: -take } }, { session });
          if (!res.matchedCount) throw ApiError.conflict(`${v.name}: stock changed while billing. Try again.`);
          need -= take;
          const price = priceSaleLine({ units: take, unitsPerPack: b.unitsPerPack || upp, mrp: b.mrp, discountPct: l.discountPct, gstPercent: v.gstPercent ?? 0 });
          billLines.push({
            productId: v._id,
            batchId: b._id,
            name: v.name,
            schedule: v.schedule,
            hsn: v.hsn,
            batchNo: b.batchNo,
            expiryDate: b.expiryDate,
            unitsPerPack: b.unitsPerPack || upp,
            units: take,
            mrp: b.mrp,
            discountPct: l.discountPct ?? 0,
            gstPercent: v.gstPercent ?? 0,
            ...price,
            cost: r2(((b.purchaseRate ?? 0) * take) / (b.unitsPerPack || upp)),
            costKnown: (b.purchaseRate ?? 0) > 0,
          });
          moves.push({ type: 'SALE', productId: v._id, batchId: b._id, branchId: input.branchId, qty: -take, unitsPerPack: b.unitsPerPack, mrp: b.mrp, userId: user.id });
        }
      }

      const sum = (k) => r2(billLines.reduce((s, l) => s + l[k], 0));
      const exact = sum('total');
      const grand = Math.round(exact);
      const paid = r2(input.payments.reduce((s, p) => s + p.amount, 0));
      if (Math.abs(paid - grand) > 0.009) throw ApiError.badRequest(`Payments (${paid}) must add up to the bill total (${grand})`);

      // a UPI amount collected through the gateway must match a verified, unused payment for this outlet
      const payments = [];
      const toMark = [];
      for (const p of input.payments) {
        if (!p.orderId) {
          payments.push({ mode: p.mode, amount: p.amount, reference: p.reference });
          continue;
        }
        if (p.mode !== 'UPI') throw ApiError.badRequest('Only UPI payments can carry an online payment');
        const op = await OnlinePayment.findOne({ orderId: p.orderId }).session(session);
        if (!op || op.status !== 'paid') throw ApiError.badRequest('The online payment is not confirmed, or is already used on another bill');
        if (String(op.branchId) !== String(input.branchId)) throw ApiError.badRequest('This payment was taken in a different outlet');
        if (Math.abs(op.amount - p.amount) > 0.009) throw ApiError.badRequest(`The UPI amount (${p.amount}) must match what the customer paid online (${op.amount})`);
        payments.push({ mode: 'UPI', amount: p.amount, reference: op.paymentId, gateway: op.gateway, orderId: op.orderId, paymentId: op.paymentId });
        toMark.push(op._id);
      }

      const number = await nextNumber(session, 'sale', 'SAL');
      [sale] = await Sale.create(
        [
          {
            number,
            branchId: input.branchId,
            customerId: customer?._id,
            customerName: customer?.name ?? input.customerName,
            customerPhone: customer?.phone ?? input.customerPhone,
            ...taxParty(branch, shopGstin, customer),
            prescriber: needsRx ? rx : undefined,
            lines: billLines,
            totals: { gross: sum('gross'), discount: sum('discount'), taxable: sum('taxable'), gst: sum('gst'), roundOff: r2(grand - exact), grand },
            payments,
            soldBy: user.id,
            soldByName: seller?.name,
          },
        ],
        { session },
      );
      await StockLedger.create(moves.map((m) => ({ ...m, reference: number })), { session, ordered: true });
      for (const id of toMark) {
        const r = await OnlinePayment.updateOne({ _id: id, status: 'paid' }, { $set: { status: 'used', saleId: sale._id } }, { session });
        if (!r.matchedCount) throw ApiError.conflict('The online payment was just used on another bill');
      }
    });
  } finally {
    await session.endSession();
  }
  return sale;
}

export async function listSales({ branchId, branchIds, customerId, q, from, to, page = 1, limit = 20 }) {
  const filter = {};
  if (customerId) filter.customerId = customerId;
  if (branchId) filter.branchId = branchId;
  else if (branchIds?.length) filter.branchId = { $in: branchIds };
  if (q?.trim()) {
    const rx = new RegExp(esc(q.trim()), 'i');
    filter.$or = [{ number: rx }, { customerName: rx }, { customerPhone: rx }];
  }
  if (from || to) {
    filter.createdAt = { ...(from && { $gte: new Date(`${from}T00:00:00.000Z`) }), ...(to && { $lte: new Date(`${to}T23:59:59.999Z`) }) };
  }
  const [items, total] = await Promise.all([
    Sale.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('branchId', 'name code').select('-lines').lean(),
    Sale.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

export async function getSale(id) {
  const sale = await Sale.findById(id).populate('branchId', 'name code address city state pincode phone gstin drugLicenseNo pharmacistName pharmacistRegNo').lean();
  if (!sale) throw ApiError.notFound('Bill not found');
  // the shop's own details fill in whatever the outlet has not set
  const shop = await Tenant.findById(sale.tenantId).select('name address phone gstin drugLicenseNo').lean();
  const returns = await SaleReturn.find({ saleId: id }).sort({ createdAt: 1 }).lean();
  // the part of this bill that can go back to the customer's UPI through Razorpay
  const gp = gatewayPayment(sale);
  const gateway = gp ? { paymentId: gp.paymentId, amount: gp.amount, remaining: await gatewayRemaining(sale._id, gp) } : null;
  const { shareToken, ...rest } = sale; // the secret itself is never sent to the screen
  return { ...rest, shared: Boolean(shareToken), shop, returns, gateway };
}

/**
 * The link to send a customer (WhatsApp). The first time it is made a secret token is saved on the bill; the same link is used after that.
 * Anyone with the link can read that one bill (nothing else), so it is long and random.
 */
export async function shareBill(saleId) {
  const sale = await Sale.findById(saleId);
  if (!sale) throw ApiError.notFound('Bill not found');
  if (!sale.shareToken) {
    sale.shareToken = crypto.randomBytes(24).toString('base64url');
    await sale.save();
  }
  const shop = await Tenant.findById(sale.tenantId).select('name phone').lean();
  const branch = await Branch.findById(sale.branchId).select('name phone').lean();
  return {
    url: `${env.FRONTEND_URL.replace(/\/$/, '')}/bill/${sale.shareToken}`,
    number: sale.number,
    date: sale.createdAt,
    total: sale.totals.grand,
    customerName: sale.customerName ?? '',
    phone: sale.customerPhone ?? '',
    shopName: shop?.name ?? '',
    shopPhone: branch?.phone || shop?.phone || '',
  };
}

/** Turns the link off: the old address stops working. A new share makes a new address. */
export async function stopSharing(saleId) {
  const r = await Sale.updateOne({ _id: saleId }, { $unset: { shareToken: 1 } });
  if (!r.matchedCount) throw ApiError.notFound('Bill not found');
}

/** What the customer's link shows: the bill as printed, and nothing internal (no cost, no staff, no customer record). No sign-in needed. */
export async function publicBill(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token ?? '')) throw ApiError.notFound('This bill link is not valid');
  const sale = await Sale.findOne({ shareToken: token }).setOptions({ skipTenant: true }).lean();
  if (!sale) throw ApiError.notFound('This bill link is not valid or was turned off');
  const [branch, shop] = await Promise.all([
    Branch.findById(sale.branchId).setOptions({ skipTenant: true }).select('name code address city state pincode phone gstin drugLicenseNo pharmacistName pharmacistRegNo').lean(),
    Tenant.findById(sale.tenantId).select('name address phone gstin drugLicenseNo').lean(),
  ]);
  return {
    number: sale.number,
    createdAt: sale.createdAt,
    status: sale.status,
    customerName: sale.customerName,
    customerPhone: sale.customerPhone,
    prescriber: sale.prescriber,
    lines: sale.lines.map((l) => ({ name: l.name, batchNo: l.batchNo, expiryDate: l.expiryDate, unitsPerPack: l.unitsPerPack, units: l.units, returnedUnits: l.returnedUnits, mrp: l.mrp, discountPct: l.discountPct, gstPercent: l.gstPercent, gross: l.gross, discount: l.discount, taxable: l.taxable, gst: l.gst, total: l.total, schedule: l.schedule, hsn: l.hsn })),
    totals: sale.totals,
    payments: sale.payments.map((p) => ({ mode: p.mode, amount: p.amount })),
    branchId: branch && (({ _id, ...rest }) => rest)(branch),
    shop: shop && (({ _id, ...rest }) => rest)(shop),
    cancelReason: sale.status === 'CANCELLED' ? sale.cancelReason : undefined,
  };
}

/** Takes items back into stock and records the refund. Units per line are capped by what was sold and not yet returned. */
export async function createSaleReturn(user, saleId, input) {
  const session = await mongoose.startSession();
  let doc;
  try {
    await session.withTransaction(async () => {
      const sale = await Sale.findById(saleId).session(session);
      if (!sale) throw ApiError.notFound('Bill not found');
      const lines = [];
      const moves = [];
      for (const r of input.lines) {
        const line = sale.lines.find((l) => String(l.batchId) === r.batchId);
        if (!line) throw ApiError.badRequest('That item is not on this bill');
        const left = line.units - line.returnedUnits;
        if (r.units > left) throw ApiError.conflict(`${line.name}: only ${left} unit${left === 1 ? '' : 's'} can still be returned`);
        line.returnedUnits += r.units;
        const refund = r2((line.total * r.units) / line.units);
        lines.push({ batchId: line.batchId, name: line.name, batchNo: line.batchNo, units: r.units, refund });
        await Batch.updateOne({ _id: line.batchId }, { $inc: { quantity: r.units } }, { session });
        moves.push({ type: 'RETURN', productId: line.productId, batchId: line.batchId, branchId: sale.branchId, qty: r.units, unitsPerPack: line.unitsPerPack, mrp: line.mrp, reference: sale.number, reason: input.reason, userId: user.id });
      }
      if (sale.lines.every((l) => l.returnedUnits >= l.units)) sale.status = 'RETURNED';
      await sale.save({ session });
      await StockLedger.create(moves, { session, ordered: true });
      const total = r2(lines.reduce((s, l) => s + l.refund, 0));
      if (input.refundMode === 'CREDIT' && !sale.customerId) throw ApiError.badRequest('This bill has no customer, so it cannot be returned against udhaar. Refund it in cash.');
      let gatewayRefund;
      if (input.refundMode === 'GATEWAY') {
        const gp = gatewayPayment(sale);
        if (!gp) throw ApiError.badRequest("This bill was not paid through Razorpay, so it cannot be refunded to the customer's UPI. Refund it in cash.");
        const remaining = await gatewayRemaining(sale._id, gp, session);
        if (total > remaining + 0.009) throw ApiError.badRequest(`Only ₹${remaining} of this bill can still be sent back to the customer's UPI. Refund the rest in cash.`);
        gatewayRefund = { paymentId: gp.paymentId, amount: total, status: 'requested' };
      }
      const number = await nextNumber(session, 'sale-return', 'SRN');
      [doc] = await SaleReturn.create(
        [{ number, saleId, saleNumber: sale.number, customerId: sale.customerId, branchId: sale.branchId, reason: input.reason, lines, refund: total, refundMode: input.refundMode === 'GATEWAY' ? 'UPI' : input.refundMode, gatewayRefund, createdBy: user.id }],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  // the stock and the return are saved; now ask Razorpay to send the money back (the outcome is stored on the return)
  if (doc.gatewayRefund?.paymentId) doc = await sendRefund(await SaleReturn.findById(doc._id));
  return doc;
}

export const CANCEL_WITHIN_DAYS = 7;

/**
 * Cancels a whole bill (it was made by mistake). All stock goes back to its batches, and what the customer paid is refunded the way it was
 * paid: cash from the drawer, card and own-QR UPI by hand, Razorpay UPI back to the customer's UPI, udhaar taken off what they owe.
 * It is recorded as ordinary returns (one per way of payment), so every report, the cash count and the udhaar statement already agree.
 * A bill that already has something returned cannot be cancelled (return the rest instead), nor one older than CANCEL_WITHIN_DAYS.
 */
export async function cancelSale(user, saleId, { reason }) {
  const session = await mongoose.startSession();
  const made = [];
  let sale;
  try {
    await session.withTransaction(async () => {
      made.length = 0;
      sale = await Sale.findById(saleId).session(session);
      if (!sale) throw ApiError.notFound('Bill not found');
      if (sale.status === 'CANCELLED') throw ApiError.conflict('This bill is already cancelled');
      if (sale.lines.some((l) => l.returnedUnits > 0)) throw ApiError.conflict('Something from this bill was already returned, so it cannot be cancelled as a whole. Return the rest of the items instead.');
      if (Date.now() - new Date(sale.createdAt).getTime() > CANCEL_WITHIN_DAYS * 86_400_000) throw ApiError.conflict(`A bill can be cancelled only within ${CANCEL_WITHIN_DAYS} days. For an older bill, take the items back with a return.`);

      const moves = [];
      const lines = [];
      for (const line of sale.lines) {
        line.returnedUnits = line.units;
        lines.push({ batchId: line.batchId, name: line.name, batchNo: line.batchNo, units: line.units, refund: line.total });
        await Batch.updateOne({ _id: line.batchId }, { $inc: { quantity: line.units } }, { session });
        moves.push({ type: 'RETURN', productId: line.productId, batchId: line.batchId, branchId: sale.branchId, qty: line.units, unitsPerPack: line.unitsPerPack, mrp: line.mrp, reference: sale.number, reason: `BILL_CANCELLED: ${reason}`, userId: user.id });
      }
      sale.status = 'CANCELLED';
      sale.cancelledAt = new Date();
      sale.cancelReason = reason;
      sale.cancelledByName = user.name;
      await sale.save({ session });
      await StockLedger.create(moves, { session, ordered: true });

      // the money goes back the way it came, one return per part of the payment
      const parts = sale.payments.filter((p) => p.amount > 0);
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.mode === 'CREDIT' && !sale.customerId) throw ApiError.badRequest('This bill has udhaar but no customer, so it cannot be cancelled automatically. Ask support.');
        let gatewayRefund;
        if (p.mode === 'UPI' && p.paymentId && p.gateway === 'razorpay') {
          const remaining = await gatewayRemaining(sale._id, p, session);
          if (p.amount <= remaining + 0.009) gatewayRefund = { paymentId: p.paymentId, amount: p.amount, status: 'requested' };
        }
        const number = await nextNumber(session, 'sale-return', 'SRN');
        const [doc] = await SaleReturn.create(
          [{ number, saleId, saleNumber: sale.number, customerId: sale.customerId, branchId: sale.branchId, reason: `Bill cancelled: ${reason}`, lines: i === 0 ? lines : [], refund: r2(p.amount), refundMode: p.mode, gatewayRefund, createdBy: user.id }],
          { session },
        );
        made.push(doc);
      }
    });
  } finally {
    await session.endSession();
  }
  // the bill is cancelled and recorded; now ask Razorpay to send its part back (the outcome is stored on that return)
  const returns = [];
  for (const d of made) returns.push(d.gatewayRefund?.paymentId ? await sendRefund(await SaleReturn.findById(d._id)) : d);
  return { number: sale.number, status: sale.status, returns };
}

/** Tries a failed (or never-sent) UPI refund again. */
export async function retryGatewayRefund(saleId, returnId) {
  const ret = await SaleReturn.findOne({ _id: returnId, saleId });
  if (!ret?.gatewayRefund) throw ApiError.notFound('Refund not found');
  if (!['failed', 'requested'].includes(ret.gatewayRefund.status)) throw ApiError.conflict('This refund is already on its way.');
  return sendRefund(ret);
}
