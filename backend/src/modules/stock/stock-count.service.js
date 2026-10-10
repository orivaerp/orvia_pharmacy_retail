import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { Branch } from '../branches/branch.model.js';
import { Product, toView } from '../products/product.model.js';
import { Batch, StockLedger } from './stock.model.js';
import { StockCount } from './stock-count.model.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const perPack = (u, upp) => ({ packs: Math.trunc(u / upp), loose: u % upp }); // for a signed number of units too

async function load(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Stock count not found');
  const c = await StockCount.findById(id);
  if (!c) throw ApiError.notFound('Stock count not found');
  return c;
}

export async function startCount(user, { branchId, name }) {
  const branch = await Branch.findById(branchId);
  if (!branch || !branch.isActive) throw ApiError.badRequest('Choose an active outlet');
  const open = await StockCount.findOne({ branchId, status: { $in: ['OPEN', 'REVIEW'] } }).select('name status').lean();
  if (open) throw ApiError.conflict(`A stock count ("${open.name}") is already ${open.status === 'OPEN' ? 'in progress' : 'waiting for review'} for this outlet. Finish or cancel it first.`);
  const stamp = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
  return StockCount.create({ branchId, name: name?.trim() || `Stock count ${stamp}`, startedBy: user.id, startedByName: user.name });
}

/** The batches to count (everything with stock in the outlet), with the shop's own count so far. The stock Orvia holds is NOT sent: the count is blind. */
export async function sheet(id) {
  const c = await load(id);
  if (c.status !== 'OPEN') throw ApiError.conflict('This count is no longer open for counting');
  const batches = await Batch.find({ branchId: c.branchId, quantity: { $gt: 0 } }).lean();
  const products = await Product.find({ _id: { $in: [...new Set(batches.map((b) => String(b.productId)))] } }).populate('masterId');
  const view = new Map(products.map((p) => [String(p._id), toView(p)]));
  const mine = new Map(c.lines.map((l) => [String(l.batchId), l]));
  const rows = batches
    .filter((b) => view.has(String(b.productId)))
    .map((b) => {
      const v = view.get(String(b.productId));
      const l = mine.get(String(b._id));
      const upp = b.unitsPerPack || v.unitsPerPack || 1;
      return {
        batchId: b._id,
        productId: b.productId,
        name: v.name,
        manufacturer: v.manufacturer,
        location: v.location || '',
        barcodes: v.barcodes,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
        mrp: b.mrp,
        unitsPerPack: upp,
        looseSelling: Boolean(v.looseSelling),
        counted: l ? { ...perPack(l.countedUnits, upp) } : null,
      };
    })
    .sort((a, b) => (a.location || '￿').localeCompare(b.location || '￿') || a.name.localeCompare(b.name) || new Date(a.expiryDate) - new Date(b.expiryDate));
  return { count: summaryOf(c), rows };
}

const summaryOf = (c) => ({ _id: c._id, name: c.name, status: c.status, branchId: c.branchId, counted: c.lines.length, startedByName: c.startedByName, createdAt: c.createdAt, submittedAt: c.submittedAt, appliedAt: c.appliedAt, appliedByName: c.appliedByName, summary: c.summary });

/** Saves what was counted for one batch (or clears it when both numbers are 0 and `clear` is set). */
export async function saveLine(id, { batchId, packs = 0, loose = 0, clear = false }) {
  const c = await load(id);
  if (c.status !== 'OPEN') throw ApiError.conflict('This count is no longer open for counting');
  if (clear) {
    await StockCount.updateOne({ _id: c._id }, { $pull: { lines: { batchId } } });
    return { cleared: true };
  }
  const batch = await Batch.findOne({ _id: batchId, branchId: c.branchId });
  if (!batch) throw ApiError.notFound('Batch not found in this outlet');
  const product = await Product.findById(batch.productId).populate('masterId');
  const v = toView(product);
  const upp = batch.unitsPerPack || v.unitsPerPack || 1;
  if (loose > 0 && !v.looseSelling) throw ApiError.badRequest(`${v.name} is not sold loose, so count whole packs only`);
  if (loose >= upp && upp > 1) throw ApiError.badRequest(`Loose units must be less than one pack (${upp}). Add whole packs under Packs`);
  const line = {
    batchId: batch._id,
    productId: batch.productId,
    name: v.name,
    batchNo: batch.batchNo,
    expiryDate: batch.expiryDate,
    unitsPerPack: upp,
    purchaseRate: batch.purchaseRate ?? 0,
    mrp: batch.mrp,
    countedUnits: packs * upp + loose,
    systemAtCount: batch.quantity,
    countedAt: new Date(),
  };
  // replace this batch's line if it is there, otherwise add it
  const res = await StockCount.updateOne({ _id: c._id, 'lines.batchId': batch._id }, { $set: { 'lines.$': line } });
  if (!res.matchedCount) await StockCount.updateOne({ _id: c._id, 'lines.batchId': { $ne: batch._id } }, { $push: { lines: line } });
  return { counted: line.countedUnits };
}

export async function submit(id) {
  const c = await load(id);
  if (c.status !== 'OPEN') throw ApiError.conflict('This count is not open');
  if (!c.lines.length) throw ApiError.badRequest('Nothing has been counted yet');
  c.status = 'REVIEW';
  c.submittedAt = new Date();
  await c.save();
  return summaryOf(c);
}

export async function reopen(id) {
  const c = await load(id);
  if (c.status !== 'REVIEW') throw ApiError.conflict('Only a count waiting for review can be reopened');
  c.status = 'OPEN';
  await c.save();
  return summaryOf(c);
}

export async function cancel(id) {
  const c = await load(id);
  if (!['OPEN', 'REVIEW'].includes(c.status)) throw ApiError.conflict('This count is already finished');
  c.status = 'CANCELLED';
  await c.save();
  return summaryOf(c);
}

/** The differences: what was counted against what Orvia held when each batch was counted, with their value at cost. */
export async function review(id) {
  const c = await load(id);
  const lines = c.lines.map((l) => {
    const diff = l.countedUnits - l.systemAtCount;
    const upp = l.unitsPerPack || 1;
    return {
      batchId: l.batchId,
      name: l.name,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      unitsPerPack: upp,
      system: perPack(l.systemAtCount, upp),
      counted: perPack(l.countedUnits, upp),
      diffUnits: diff,
      diff: perPack(diff, upp),
      value: r2((diff / upp) * (l.purchaseRate || 0)), // at cost; negative = short
      costKnown: (l.purchaseRate || 0) > 0,
    };
  });
  const changed = lines.filter((l) => l.diffUnits !== 0);
  // batches with stock that nobody counted
  const countedIds = new Set(c.lines.map((l) => String(l.batchId)));
  const all = await Batch.find({ branchId: c.branchId, quantity: { $gt: 0 } }).select('batchNo quantity unitsPerPack purchaseRate productId').lean();
  const uncounted = all.filter((b) => !countedIds.has(String(b._id)));
  const uncountedValue = r2(uncounted.reduce((s, b) => s + (b.quantity / (b.unitsPerPack || 1)) * (b.purchaseRate || 0), 0));
  return {
    count: summaryOf(c),
    lines: changed.sort((a, b) => a.value - b.value),
    matched: lines.length - changed.length,
    totals: {
      counted: lines.length,
      changed: changed.length,
      shortValue: r2(-changed.filter((l) => l.value < 0).reduce((s, l) => s + l.value, 0)),
      extraValue: r2(changed.filter((l) => l.value > 0).reduce((s, l) => s + l.value, 0)),
      noCostLines: changed.filter((l) => !l.costKnown).length,
    },
    uncounted: { batches: uncounted.length, value: uncountedValue },
  };
}

/**
 * Applies the corrections in one transaction: each difference is added to the batch (a ledger row of type ADJUST, reason COUNT_CORRECTION).
 * If a batch has since fallen so low that a shortage cannot be taken off, nothing is applied and the owner is told which one.
 * `uncountedAsZero` also writes off every batch nobody counted (only when the owner says so).
 */
export async function apply(user, id, { uncountedAsZero = false, note } = {}) {
  const c = await load(id);
  if (c.status !== 'REVIEW') throw ApiError.conflict('Only a count that was finished counting can be applied');
  const countedIds = new Set(c.lines.map((l) => String(l.batchId)));
  const session = await mongoose.startSession();
  const stats = { counted: c.lines.length, changed: 0, shortUnits: 0, extraUnits: 0, shortValue: 0, extraValue: 0, uncountedWrittenOff: 0 };
  try {
    await session.withTransaction(async () => {
      Object.assign(stats, { changed: 0, shortUnits: 0, extraUnits: 0, shortValue: 0, extraValue: 0, uncountedWrittenOff: 0 });
      const fix = async (batchId, productId, delta, unitsPerPack, purchaseRate, mrp, name, batchNo) => {
        if (delta === 0) return;
        const res = await Batch.updateOne({ _id: batchId, ...(delta < 0 && { quantity: { $gte: -delta } }) }, { $inc: { quantity: delta } }, { session });
        if (!res.matchedCount) throw ApiError.conflict(`${name} (batch ${batchNo}) has fewer units now than the count found missing, because of bills made since. Count it again.`);
        await StockLedger.create([{ type: 'ADJUST', productId, batchId, branchId: c.branchId, qty: delta, unitsPerPack, purchaseRate, mrp, reason: 'COUNT_CORRECTION', reference: c.name, note, userId: user.id }], { session });
        stats.changed += 1;
        const value = (Math.abs(delta) / (unitsPerPack || 1)) * (purchaseRate || 0);
        if (delta < 0) {
          stats.shortUnits += -delta;
          stats.shortValue += value;
        } else {
          stats.extraUnits += delta;
          stats.extraValue += value;
        }
      };
      for (const l of c.lines) await fix(l.batchId, l.productId, l.countedUnits - l.systemAtCount, l.unitsPerPack, l.purchaseRate, l.mrp, l.name, l.batchNo);
      if (uncountedAsZero) {
        const rest = await Batch.find({ branchId: c.branchId, quantity: { $gt: 0 } }).session(session);
        for (const b of rest.filter((x) => !countedIds.has(String(x._id)))) {
          const p = await Product.findById(b.productId).populate('masterId').session(session);
          await fix(b._id, b.productId, -b.quantity, b.unitsPerPack, b.purchaseRate, b.mrp, p ? toView(p).name : 'A product', b.batchNo);
          stats.uncountedWrittenOff += 1;
        }
      }
    });
  } finally {
    await session.endSession();
  }
  c.status = 'APPLIED';
  c.appliedAt = new Date();
  c.appliedByName = user.name;
  c.uncountedAsZero = uncountedAsZero;
  c.note = note;
  c.summary = { ...stats, shortValue: r2(stats.shortValue), extraValue: r2(stats.extraValue) };
  await c.save();
  return summaryOf(c);
}

export async function list(branchId) {
  const rows = await StockCount.find({ branchId }).sort({ createdAt: -1 }).limit(30).select('-lines').lean();
  return rows.map((c) => ({ ...c, counted: undefined }));
}

export async function current(branchId) {
  const c = await StockCount.findOne({ branchId, status: { $in: ['OPEN', 'REVIEW'] } });
  return c ? summaryOf(c) : null;
}
