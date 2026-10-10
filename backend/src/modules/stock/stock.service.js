import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { Branch } from '../branches/branch.model.js';
import { Product, toView } from '../products/product.model.js';
import crypto from 'node:crypto';
import { effectiveReorder, getLowStockDefault } from './low-stock.js';
import { ADJUST_REASONS, Batch, StockLedger, endOfMonth } from './stock.model.js';

const DAY = 24 * 60 * 60 * 1000;
export const SOON_DAYS = 90;

/** Loads the products a stock movement refers to and refuses unknown or inactive ones. Returns a map by id. */
export async function loadReceivableProducts(productIds) {
  const ids = [...new Set(productIds)];
  const products = await Product.find({ _id: { $in: ids } }).populate('masterId');
  const byId = new Map(products.map((p) => [String(p._id), p]));
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) throw ApiError.badRequest('One of the products no longer exists');
    if (!p.isActive) throw ApiError.badRequest(`"${toView(p).name}" is inactive. Activate it before adding stock.`);
  }
  return byId;
}

/**
 * Puts packs of one batch into an outlet, inside the caller's transaction, and writes the ledger row.
 * The same batch number must keep the same expiry and MRP. `packs` is the TOTAL packs received (free packs included).
 */
export async function receiveBatch(session, { userId, branchId, productDoc, batchNo, expiry, mrp, purchaseRate, packs, type, reference, supplierName }) {
  const product = toView(productDoc);
  const expiryDate = endOfMonth(expiry);
  if (expiryDate < new Date()) throw ApiError.badRequest(`${product.name}: batch ${batchNo} has already expired`);

  const unitsPerPack = product.unitsPerPack || 1;
  const units = packs * unitsPerPack;
  const no = batchNo.trim().toUpperCase();

  let batch = await Batch.findOne({ productId: productDoc._id, branchId, batchNo: no }).session(session);
  if (batch) {
    if (batch.expiryDate.getTime() !== expiryDate.getTime()) {
      throw ApiError.conflict(`${product.name}: batch ${no} already exists with a different expiry. Check the batch number.`);
    }
    if (batch.mrp !== mrp) {
      throw ApiError.conflict(`${product.name}: batch ${no} already exists with MRP ${batch.mrp}. A batch has one MRP.`);
    }
    batch.quantity += units;
    batch.purchaseRate = purchaseRate;
    await batch.save({ session });
  } else {
    [batch] = await Batch.create([{ productId: productDoc._id, branchId, batchNo: no, expiryDate, mrp, purchaseRate, unitsPerPack, quantity: units }], { session });
  }

  await StockLedger.create(
    [{ type, productId: productDoc._id, batchId: batch._id, branchId, qty: units, unitsPerPack, purchaseRate, mrp, reference, supplierName, userId }],
    { session },
  );
  return { productId: String(productDoc._id), name: product.name, batchNo: no, packs, units, batchId: batch._id };
}

/**
 * Receives stock (opening balance or a purchase) into one outlet.
 * All lines are applied in one transaction: either every batch and ledger row is written, or none.
 */
export async function createStockEntry(user, input) {
  const branch = await Branch.findById(input.branchId);
  if (!branch || !branch.isActive) throw ApiError.badRequest('Choose an active outlet');
  const byId = await loadReceivableProducts(input.lines.map((l) => l.productId));

  const session = await mongoose.startSession();
  const received = [];
  try {
    await session.withTransaction(async () => {
      received.length = 0; // a retried transaction starts clean
      for (const line of input.lines) {
        const r = await receiveBatch(session, {
          userId: user.id,
          branchId: input.branchId,
          productDoc: byId.get(line.productId),
          batchNo: line.batchNo,
          expiry: line.expiry,
          mrp: line.mrp,
          purchaseRate: line.purchaseRate,
          packs: line.packs,
          type: input.type,
          reference: input.reference,
          supplierName: input.supplierName,
        });
        received.push({ productId: r.productId, name: r.name, batchNo: r.batchNo, packs: r.packs, units: r.units });
      }
    });
  } finally {
    await session.endSession();
  }
  return { branch: { _id: branch._id, name: branch.name }, lines: received };
}

/** One outlet if asked for, otherwise any of the outlets this user may see (undefined = no restriction). */
function outletMatch(branchId, branchIds) {
  const oid = (id) => new mongoose.Types.ObjectId(id);
  if (branchId) return { branchId: oid(branchId) };
  if (branchIds?.length) return { branchId: { $in: branchIds.map(oid) } };
  return {};
}

/** Stock per product for an outlet (or all outlets), with low-stock and expiry flags. */
export async function stockSummary({ branchId, branchIds, q, filter, page = 1, limit = 20 }) {
  const productFilter = {};
  const text = q?.trim();
  if (text) {
    const rx = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const { Medicine } = await import('../medicines/medicine.model.js');
    const masterIds = (await Medicine.find({ $or: [{ name: rx }, { composition: rx }, { manufacturer: rx }, { barcodes: text }] }).limit(500).select('_id').lean()).map((m) => m._id);
    productFilter.$or = [{ masterId: { $in: masterIds } }, { name: rx }, { composition: rx }];
  }
  productFilter.isActive = true;

  const shopDefault = await getLowStockDefault();
  const [products, totals] = await Promise.all([
    Product.find(productFilter).populate('masterId').limit(2000),
    Batch.aggregate([
      { $match: { quantity: { $gt: 0 }, ...outletMatch(branchId, branchIds) } },
      { $group: { _id: '$productId', units: { $sum: '$quantity' }, nearestExpiry: { $min: '$expiryDate' }, batches: { $sum: 1 } } },
    ]),
  ]);
  const stock = new Map(totals.map((t) => [String(t._id), t]));

  const now = Date.now();
  let rows = products.map((p) => {
    const v = toView(p);
    const s = stock.get(String(p._id));
    const units = s?.units ?? 0;
    const packs = Math.floor(units / (v.unitsPerPack || 1));
    const nearest = s?.nearestExpiry ?? null;
    return {
      productId: p._id,
      name: v.name,
      composition: v.composition,
      manufacturer: v.manufacturer,
      schedule: v.schedule,
      gstPercent: v.gstPercent,
      unitsPerPack: v.unitsPerPack,
      reorderLevel: v.reorderLevel, // the product's own
      maxLevel: v.maxLevel ?? 0,
      reorderEffective: effectiveReorder(v.reorderLevel, shopDefault), // what is used: its own, else the shop default
      units,
      packs,
      loose: units - packs * (v.unitsPerPack || 1),
      batches: s?.batches ?? 0,
      nearestExpiry: nearest,
      stockStatus: units === 0 ? 'out' : effectiveReorder(v.reorderLevel, shopDefault) > 0 && packs <= effectiveReorder(v.reorderLevel, shopDefault) ? 'low' : 'ok',
      expiryStatus: !nearest ? null : nearest.getTime() < now ? 'expired' : nearest.getTime() - now <= SOON_DAYS * DAY ? 'soon' : 'ok',
    };
  });

  if (filter === 'instock') rows = rows.filter((r) => r.units > 0);
  else if (filter === 'out') rows = rows.filter((r) => r.stockStatus === 'out');
  else if (filter === 'low') rows = rows.filter((r) => r.stockStatus === 'low' || r.stockStatus === 'out');
  else if (filter === 'expiring') rows = rows.filter((r) => r.expiryStatus === 'soon' || r.expiryStatus === 'expired');

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
}

/** Batches of one product with stock, earliest expiry first (the order FEFO selling will use). */
export async function productBatches(productId, branchId, branchIds) {
  const filter = { productId, quantity: { $gt: 0 }, ...outletMatch(branchId, branchIds) };
  const batches = await Batch.find(filter).sort({ expiryDate: 1 }).populate('branchId', 'name code').lean();
  const now = Date.now();
  return batches.map((b) => ({
    ...b,
    packs: Math.floor(b.quantity / (b.unitsPerPack || 1)),
    loose: b.quantity % (b.unitsPerPack || 1),
    expiryStatus: b.expiryDate.getTime() < now ? 'expired' : b.expiryDate.getTime() - now <= SOON_DAYS * DAY ? 'soon' : 'ok',
  }));
}

/**
 * Writes off or corrects stock of existing batches in one outlet.
 * Reasons decide the direction (breakage can only reduce; "found" can only add); stock can never go below zero.
 * All lines are applied in one transaction.
 */
export async function createAdjustment(user, input) {
  const direction = ADJUST_REASONS[input.reason];
  if (!direction) throw ApiError.badRequest('Choose a reason');
  if (input.reason === 'OTHER' && !input.note?.trim()) throw ApiError.badRequest('Please explain the reason in the note');

  const branch = await Branch.findById(input.branchId);
  if (!branch || !branch.isActive) throw ApiError.badRequest('Choose an active outlet');

  const session = await mongoose.startSession();
  const done = [];
  try {
    await session.withTransaction(async () => {
      done.length = 0;
      for (const line of input.lines) {
        const batch = await Batch.findOne({ _id: line.batchId, branchId: input.branchId }).session(session);
        if (!batch) throw ApiError.notFound('Batch not found in this outlet');
        if (direction === 'out' && line.packs > 0) throw ApiError.badRequest(`${input.reason.toLowerCase()} can only reduce stock`);
        if (direction === 'in' && line.packs < 0) throw ApiError.badRequest('"Found" can only add stock');

        const units = line.packs * (batch.unitsPerPack || 1);
        const res = await Batch.updateOne(
          { _id: batch._id, ...(units < 0 && { quantity: { $gte: -units } }) },
          { $inc: { quantity: units } },
          { session },
        );
        if (!res.matchedCount) {
          const have = Math.floor(batch.quantity / (batch.unitsPerPack || 1));
          throw ApiError.conflict(`Batch ${batch.batchNo} has only ${have} pack${have === 1 ? '' : 's'} left, so ${-line.packs} cannot be removed`);
        }
        await StockLedger.create(
          [{ type: 'ADJUST', productId: batch.productId, batchId: batch._id, branchId: batch.branchId, qty: units, unitsPerPack: batch.unitsPerPack, mrp: batch.mrp, reason: input.reason, note: input.note, userId: user.id }],
          { session },
        );
        done.push({ batchNo: batch.batchNo, packs: line.packs, units, left: batch.quantity + units });
      }
    });
  } finally {
    await session.endSession();
  }
  return { branch: { _id: branch._id, name: branch.name }, lines: done };
}

/**
 * Moves batches from one outlet to another. The same batch (batch no., expiry, MRP) appears in the destination,
 * and two ledger rows (TRANSFER_OUT and TRANSFER_IN) share one transfer id. Stock never goes below zero.
 */
export async function createTransfer(user, input) {
  if (input.fromBranchId === input.toBranchId) throw ApiError.badRequest('Choose two different outlets');
  const [from, to] = await Promise.all([Branch.findById(input.fromBranchId), Branch.findById(input.toBranchId)]);
  if (!from?.isActive || !to?.isActive) throw ApiError.badRequest('Both outlets must be active');

  const transferId = crypto.randomUUID();
  const session = await mongoose.startSession();
  const done = [];
  try {
    await session.withTransaction(async () => {
      done.length = 0;
      for (const line of input.lines) {
        const src = await Batch.findOne({ _id: line.batchId, branchId: from._id }).session(session);
        if (!src) throw ApiError.notFound(`That batch is not in ${from.name}`);
        if (src.expiryDate.getTime() < Date.now()) throw ApiError.badRequest(`Batch ${src.batchNo} has expired. Write it off instead of moving it.`);

        const units = line.packs * (src.unitsPerPack || 1);
        const out = await Batch.updateOne({ _id: src._id, quantity: { $gte: units } }, { $inc: { quantity: -units } }, { session });
        if (!out.matchedCount) {
          const have = Math.floor(src.quantity / (src.unitsPerPack || 1));
          throw ApiError.conflict(`Batch ${src.batchNo} has only ${have} pack${have === 1 ? '' : 's'} in ${from.name}`);
        }

        let dest = await Batch.findOne({ productId: src.productId, branchId: to._id, batchNo: src.batchNo }).session(session);
        if (dest) {
          if (dest.expiryDate.getTime() !== src.expiryDate.getTime() || dest.mrp !== src.mrp) {
            throw ApiError.conflict(`${to.name} already has a batch ${src.batchNo} with a different expiry or MRP`);
          }
          await Batch.updateOne({ _id: dest._id }, { $inc: { quantity: units } }, { session });
        } else {
          [dest] = await Batch.create(
            [{ productId: src.productId, branchId: to._id, batchNo: src.batchNo, expiryDate: src.expiryDate, mrp: src.mrp, purchaseRate: src.purchaseRate, unitsPerPack: src.unitsPerPack, quantity: units }],
            { session },
          );
        }

        const common = { productId: src.productId, unitsPerPack: src.unitsPerPack, mrp: src.mrp, transferId, note: input.note, userId: user.id };
        await StockLedger.create(
          [
            { ...common, type: 'TRANSFER_OUT', batchId: src._id, branchId: from._id, qty: -units },
            { ...common, type: 'TRANSFER_IN', batchId: dest._id, branchId: to._id, qty: units },
          ],
          { session, ordered: true },
        );
        done.push({ batchNo: src.batchNo, packs: line.packs, units });
      }
    });
  } finally {
    await session.endSession();
  }
  return { transferId, from: from.name, to: to.name, lines: done };
}

/** Stock movements, newest first, in plain terms (product name, batch, packs, who and why). */
export async function recentLedger({ productId, type, branchId, branchIds, limit = 50 }) {
  const rows = await StockLedger.find({ ...(productId && { productId }), ...(type && { type }), ...outletMatch(branchId, branchIds) })
    .sort({ at: -1 })
    .limit(limit)
    .populate({ path: 'productId', populate: { path: 'masterId', select: 'name brand' } })
    .populate('batchId', 'batchNo expiryDate')
    .populate('branchId', 'name code')
    .populate('userId', 'name')
    .lean();
  return rows.map((r) => ({
    _id: r._id,
    at: r.at,
    type: r.type,
    product: r.productId?.masterId?.name ?? r.productId?.name ?? 'Unknown product',
    batchNo: r.batchId?.batchNo,
    expiryDate: r.batchId?.expiryDate,
    outlet: r.branchId?.name,
    units: r.qty,
    packs: Math.round((r.qty / (r.unitsPerPack || 1)) * 100) / 100,
    reason: r.reason,
    note: r.note,
    reference: r.reference,
    supplierName: r.supplierName,
    transferId: r.transferId,
    by: r.userId?.name,
  }));
}
