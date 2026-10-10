import mongoose from 'mongoose';
import { Product } from '../products/product.model.js';
import { effectiveReorder, getLowStockDefault } from '../stock/low-stock.js';
import { Batch } from '../stock/stock.model.js';
import { Sale, SaleReturn } from './sale.model.js';

const TZ = 'Asia/Kolkata';
const DAY = 24 * 60 * 60 * 1000;
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD in shop time

/** Net sales (bills minus refunds) per shop-day for the last `days` days, oldest first. */
async function dailyNet(match, days) {
  const since = new Date(Date.now() - (days + 1) * DAY);
  const group = (field) => [
    { $match: { ...match, createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }, v: { $sum: field } } },
  ];
  const [sales, refunds] = await Promise.all([Sale.aggregate(group('$totals.grand')), SaleReturn.aggregate(group('$refund'))]);
  const by = new Map();
  for (const s of sales) by.set(s._id, (by.get(s._id) ?? 0) + s.v);
  for (const r of refunds) by.set(r._id, (by.get(r._id) ?? 0) - r.v);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    out.push({ date: dayKey(d), label: new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short' }).format(d), value: r2(by.get(dayKey(d)) ?? 0) });
  }
  return out;
}

/**
 * Numbers for the shop owner's dashboard. `scope` is a Mongo match on branchId (one outlet, or the outlets this user may see).
 * `parts` says which groups the caller may see, so a cashier never receives stock or money-wide numbers they should not.
 */
export async function dashboard({ branchId, branchIds, parts }) {
  const oid = (id) => new mongoose.Types.ObjectId(id);
  const scope = branchId ? { branchId: oid(branchId) } : branchIds?.length ? { branchId: { $in: branchIds.map(oid) } } : {};
  const result = { sales: null, stock: null };

  if (parts.sales) {
    const week = await dailyNet(scope, 7);
    const today = week[6].value;
    const yesterday = week[5].value;
    const monthStart = dayKey(new Date()).slice(0, 8) + '01';
    const monthFrom = new Date(`${monthStart}T00:00:00+05:30`);
    const todayFrom = new Date(`${dayKey(new Date())}T00:00:00+05:30`);

    const [billsToday, month, refundsMonth, byMode, recent] = await Promise.all([
      Sale.countDocuments({ ...scope, status: { $ne: 'CANCELLED' }, createdAt: { $gte: todayFrom } }),
      Sale.aggregate([{ $match: { ...scope, createdAt: { $gte: monthFrom } } }, { $group: { _id: null, v: { $sum: '$totals.grand' }, n: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 0, 1] } } } }]),
      SaleReturn.aggregate([{ $match: { ...scope, createdAt: { $gte: monthFrom } } }, { $group: { _id: null, v: { $sum: '$refund' } } }]),
      Sale.aggregate([
        { $match: { ...scope, createdAt: { $gte: monthFrom } } },
        { $unwind: '$payments' },
        { $group: { _id: '$payments.mode', v: { $sum: '$payments.amount' } } },
      ]),
      Sale.find(scope).sort({ createdAt: -1 }).limit(8).populate('branchId', 'name').select('number customerName payments totals createdAt status lines.name').lean(),
    ]);

    result.sales = {
      today,
      changePct: yesterday > 0 ? r2(((today - yesterday) / yesterday) * 100) : null,
      billsToday,
      month: r2((month[0]?.v ?? 0) - (refundsMonth[0]?.v ?? 0)),
      billsMonth: month[0]?.n ?? 0,
      week,
      byMode: byMode.map((m) => ({ mode: m._id, value: r2(m.v) })).sort((a, b) => b.value - a.value),
      recent: recent.map((s) => ({
        _id: s._id,
        number: s.number,
        customerName: s.customerName,
        items: s.lines?.length ?? 0,
        firstItem: s.lines?.[0]?.name,
        modes: s.payments.map((p) => p.mode),
        total: s.totals.grand,
        status: s.status,
        outlet: s.branchId?.name,
        createdAt: s.createdAt,
      })),
    };
  }

  if (parts.stock) {
    const shopDefault = await getLowStockDefault();
    const now = new Date();
    const soon = new Date(Date.now() + 30 * DAY);
    const [expiring, expired, totals, products] = await Promise.all([
      Batch.countDocuments({ ...scope, quantity: { $gt: 0 }, expiryDate: { $gte: now, $lte: soon } }),
      Batch.countDocuments({ ...scope, quantity: { $gt: 0 }, expiryDate: { $lt: now } }),
      Batch.aggregate([{ $match: { ...scope, quantity: { $gt: 0 } } }, { $group: { _id: '$productId', units: { $sum: '$quantity' }, upp: { $first: '$unitsPerPack' } } }]),
      Product.find({ isActive: true }).select('reorderLevel').lean(),
    ]);
    const have = new Map(totals.map((t) => [String(t._id), Math.floor(t.units / (t.upp || 1))]));
    let low = 0;
    let out = 0;
    for (const p of products) {
      const packs = have.get(String(p._id)) ?? 0;
      if (packs === 0) out++;
      else if (effectiveReorder(p.reorderLevel, shopDefault) > 0 && packs <= effectiveReorder(p.reorderLevel, shopDefault)) low++;
    }
    result.stock = { products: products.length, inStock: have.size, low, out, expiring30: expiring, expired };
  }
  return result;
}
