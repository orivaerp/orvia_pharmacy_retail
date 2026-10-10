import mongoose from 'mongoose';
import { Purchase } from '../purchases/purchase.model.js';
import { Sale } from '../sales/sale.model.js';
import { stockSummary } from './stock.service.js';

const DAY = 24 * 60 * 60 * 1000;
const oid = (id) => new mongoose.Types.ObjectId(id);

/**
 * What to order: every product that is low or out of stock, with a suggested number of packs.
 * Target stock = the product's Maximum if set, otherwise twice its reorder level (at least 1 pack);
 * suggestion = target minus what is on the shelf now. The usual supplier is whoever supplied it last.
 */
export async function orderList({ branchId, branchIds }) {
  const low = await stockSummary({ branchId, branchIds, filter: 'low', page: 1, limit: 2000 });
  const ids = low.items.map((r) => r.productId);
  if (!ids.length) return { items: [] };

  const scope = branchId ? { branchId: oid(branchId) } : branchIds?.length ? { branchId: { $in: branchIds.map(oid) } } : {};
  const [suppliers, sold] = await Promise.all([
    Purchase.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.productId': { $in: ids.map((i) => oid(String(i))) } } },
      { $sort: { invoiceDate: -1 } },
      { $group: { _id: '$lines.productId', supplierId: { $first: '$supplierId' }, supplierName: { $first: '$supplierName' }, rate: { $first: '$lines.rate' }, on: { $first: '$invoiceDate' } } },
    ]),
    Sale.aggregate([
      { $match: { ...scope, createdAt: { $gte: new Date(Date.now() - 30 * DAY) } } },
      { $unwind: '$lines' },
      { $match: { 'lines.productId': { $in: ids.map((i) => oid(String(i))) } } },
      { $group: { _id: '$lines.productId', units: { $sum: { $subtract: ['$lines.units', '$lines.returnedUnits'] } }, upp: { $first: '$lines.unitsPerPack' } } },
    ]),
  ]);
  const last = new Map(suppliers.map((s) => [String(s._id), s]));
  const soldBy = new Map(sold.map((s) => [String(s._id), Math.round((s.units / (s.upp || 1)) * 10) / 10]));

  const items = low.items.map((r) => {
    const target = r.maxLevel > 0 ? r.maxLevel : Math.max(2 * r.reorderEffective, 1);
    const l = last.get(String(r.productId));
    return {
      productId: r.productId,
      name: r.name,
      manufacturer: r.manufacturer,
      packs: r.packs,
      status: r.stockStatus,
      reorderAt: r.reorderEffective,
      maxLevel: r.maxLevel ?? 0,
      suggested: Math.max(1, target - r.packs),
      soldLast30: soldBy.get(String(r.productId)) ?? 0, // packs
      supplierId: l ? String(l.supplierId) : null,
      supplierName: l?.supplierName ?? null,
      lastRate: l?.rate ?? null,
    };
  });
  // products with a usual supplier first (by supplier name), those with none last
  items.sort((a, b) => Number(!a.supplierName) - Number(!b.supplierName) || (a.supplierName ?? '').localeCompare(b.supplierName ?? '') || a.name.localeCompare(b.name));
  return { items };
}
