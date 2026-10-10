import mongoose from 'mongoose';
import { Product, toView } from '../products/product.model.js';
import { Purchase, PurchaseReturn } from '../purchases/purchase.model.js';
import { listCustomers } from '../customers/customer.service.js';
import { listSuppliers } from '../purchases/purchase.service.js';
import { Batch } from '../stock/stock.model.js';
import { stockSummary } from '../stock/stock.service.js';
import { Expense } from '../accounts/account.model.js';
import { Sale, SaleReturn } from './sale.model.js';

const TZ = 'Asia/Kolkata';
const DAY = 24 * 60 * 60 * 1000;
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const oid = (id) => new mongoose.Types.ObjectId(id);

/** Shop-day boundaries (India time) for a YYYY-MM-DD range, end inclusive. */
export function dayRange(from, to) {
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(`${to}T23:59:59.999+05:30`);
  return { start, end };
}

const scopeOf = ({ branchId, branchIds }) => (branchId ? { branchId: oid(branchId) } : branchIds?.length ? { branchId: { $in: branchIds.map(oid) } } : {});
const between = (range) => ({ createdAt: { $gte: range.start, $lte: range.end } });
const dayOf = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } };

/** Bills per day with refunds taken off, plus the split by payment mode. */
export async function salesReport(opts) {
  const match = { ...scopeOf(opts), ...between(opts.range) };
  const [days, refunds, modes] = await Promise.all([
    Sale.aggregate([
      { $match: match },
      { $group: { _id: dayOf, bills: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 0, 1] } }, gross: { $sum: '$totals.gross' }, discount: { $sum: '$totals.discount' }, gst: { $sum: '$totals.gst' }, grand: { $sum: '$totals.grand' } } },
    ]),
    SaleReturn.aggregate([{ $match: match }, { $group: { _id: dayOf, refund: { $sum: '$refund' } } }]),
    Sale.aggregate([{ $match: match }, { $unwind: '$payments' }, { $group: { _id: '$payments.mode', amount: { $sum: '$payments.amount' } } }]),
  ]);
  const refundBy = new Map(refunds.map((r) => [r._id, r.refund]));
  const rows = days
    .sort((a, b) => (a._id < b._id ? -1 : 1))
    .map((d) => ({ date: d._id, bills: d.bills, gross: r2(d.gross), discount: r2(d.discount), gst: r2(d.gst), sales: r2(d.grand), refunds: r2(refundBy.get(d._id) ?? 0), net: r2(d.grand - (refundBy.get(d._id) ?? 0)) }));
  // refunds on days with no bills still reduce the period
  for (const [date, refund] of refundBy) if (!rows.some((r) => r.date === date)) rows.push({ date, bills: 0, gross: 0, discount: 0, gst: 0, sales: 0, refunds: r2(refund), net: r2(-refund) });
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  const sum = (k) => r2(rows.reduce((s, r) => s + r[k], 0));
  return {
    rows,
    totals: { bills: rows.reduce((s, r) => s + r.bills, 0), gross: sum('gross'), discount: sum('discount'), gst: sum('gst'), sales: sum('sales'), refunds: sum('refunds'), net: sum('net') },
    modes: modes.map((m) => ({ mode: m._id, amount: r2(m.amount) })).sort((a, b) => b.amount - a.amount),
  };
}

/** Share of each bill line that was actually kept (returned units take their tax back too). */
const kept = { $divide: [{ $subtract: ['$lines.units', '$lines.returnedUnits'] }, '$lines.units'] };

/** GST collected per rate, after returns. MRP is GST-inclusive, so tax was carved out of the price. */
export async function gstReport(opts) {
  const rows = await Sale.aggregate([
    { $match: { ...scopeOf(opts), ...between(opts.range) } },
    { $unwind: '$lines' },
    { $group: { _id: '$lines.gstPercent', taxable: { $sum: { $multiply: ['$lines.taxable', kept] } }, gst: { $sum: { $multiply: ['$lines.gst', kept] } }, total: { $sum: { $multiply: ['$lines.total', kept] } } } },
    { $sort: { _id: 1 } },
  ]);
  const out = rows.map((r) => ({ rate: r._id, taxable: r2(r.taxable), cgst: r2(r.gst / 2), sgst: r2(r.gst / 2), gst: r2(r.gst), total: r2(r.total) }));
  const sum = (k) => r2(out.reduce((s, r) => s + r[k], 0));
  return { rows: out, totals: { taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), gst: sum('gst'), total: sum('total') } };
}

/** What sold, after returns, biggest first. */
export async function itemsReport(opts) {
  const rows = await Sale.aggregate([
    { $match: { ...scopeOf(opts), ...between(opts.range) } },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.productId',
        name: { $first: '$lines.name' },
        unitsPerPack: { $first: '$lines.unitsPerPack' },
        units: { $sum: { $subtract: ['$lines.units', '$lines.returnedUnits'] } },
        amount: { $sum: { $multiply: ['$lines.total', kept] } },
      },
    },
    { $match: { units: { $gt: 0 } } },
    { $sort: { amount: -1 } },
    { $limit: 500 },
  ]);
  const out = rows.map((r) => ({ name: r.name, packs: Math.floor(r.units / r.unitsPerPack), loose: r.units % r.unitsPerPack, units: r.units, amount: r2(r.amount) }));
  return { rows: out, totals: { amount: r2(out.reduce((s, r) => s + r.amount, 0)), items: out.length } };
}

/** The Schedule H / H1 register: every such sale with doctor and patient. Kept as a record for inspectors. */
export async function registerReport(opts) {
  const rows = await Sale.aggregate([
    { $match: { ...scopeOf(opts), ...between(opts.range), 'lines.schedule': { $in: ['H', 'H1'] } } },
    { $unwind: '$lines' },
    { $match: { 'lines.schedule': { $in: ['H', 'H1'] } } },
    { $sort: { createdAt: 1 } },
    { $limit: 5000 },
  ]);
  const out = rows.map((s) => ({
    date: s.createdAt,
    bill: s.number,
    schedule: s.lines.schedule,
    medicine: s.lines.name,
    batchNo: s.lines.batchNo,
    expiry: s.lines.expiryDate,
    units: s.lines.units - s.lines.returnedUnits,
    doctor: s.prescriber?.doctorName ?? '',
    regNo: s.prescriber?.regNo ?? '',
    patient: s.prescriber?.patientName ?? '',
    age: s.prescriber?.patientAge ?? '',
    customer: s.customerName ?? '',
  }));
  return { rows: out, totals: { lines: out.length } };
}

/** Batches that still have stock and expire within `days` (0 = only already expired). Stock value at cost and at MRP. */
export async function expiryReport({ days = 90, ...opts }) {
  const now = new Date();
  const until = days === 0 ? now : new Date(Date.now() + days * DAY);
  const batches = await Batch.find({ ...scopeOf(opts), quantity: { $gt: 0 }, expiryDate: { $lte: until } })
    .sort({ expiryDate: 1 })
    .limit(2000)
    .populate('branchId', 'name')
    .lean();
  const products = await Product.find({ _id: { $in: [...new Set(batches.map((b) => String(b.productId)))] } }).populate('masterId');
  const names = new Map(products.map((p) => [String(p._id), toView(p)]));
  const rows = batches.map((b) => {
    const upp = b.unitsPerPack || 1;
    const v = names.get(String(b.productId));
    return {
      product: v?.name ?? 'Unknown',
      manufacturer: v?.manufacturer ?? '',
      batchNo: b.batchNo,
      expiry: b.expiryDate,
      status: b.expiryDate < now ? 'expired' : 'expiring',
      outlet: b.branchId?.name ?? '',
      packs: Math.floor(b.quantity / upp),
      loose: b.quantity % upp,
      costValue: r2((b.quantity / upp) * (b.purchaseRate ?? 0)),
      mrpValue: r2((b.quantity / upp) * b.mrp),
    };
  });
  const sum = (k) => r2(rows.reduce((s, r) => s + r[k], 0));
  return { rows, totals: { batches: rows.length, costValue: sum('costValue'), mrpValue: sum('mrpValue') } };
}

/** Products at or below their reorder level (or out of stock). */
export async function lowStockReport(opts) {
  const page = await stockSummary({ branchId: opts.branchId, branchIds: opts.branchIds, filter: 'low', page: 1, limit: 1000 });
  const rows = page.items.map((i) => ({ name: i.name, manufacturer: i.manufacturer, packs: i.packs, loose: i.loose, reorderLevel: i.reorderEffective, status: i.stockStatus, nearestExpiry: i.nearestExpiry }));
  return { rows, totals: { products: rows.length, out: rows.filter((r) => r.status === 'out').length } };
}

// ------------------------------------------------------------------ purchasing
// Purchase invoice dates are stored at midnight UTC of the invoice date, which the shop-day range above covers exactly.
const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const purchaseMatch = (opts) => ({ ...scopeOf(opts), invoiceDate: { $gte: opts.range.start, $lte: opts.range.end } });
const returnMatch = (opts) => ({ ...scopeOf(opts), returnedOn: { $gte: opts.range.start, $lte: opts.range.end } });

/** Supplier invoices booked in the period, one row each. */
export async function purchasesReport(opts) {
  const [rows, returned] = await Promise.all([
    Purchase.find(purchaseMatch(opts)).sort({ invoiceDate: 1, number: 1 }).limit(5000).populate('branchId', 'name').lean(),
    PurchaseReturn.aggregate([{ $match: returnMatch(opts) }, { $group: { _id: null, total: { $sum: '$total' }, n: { $sum: 1 } } }]),
  ]);
  const out = rows.map((p) => ({
    date: isoDay(p.invoiceDate),
    number: p.number,
    invoiceNo: p.invoiceNo,
    supplier: p.supplierName,
    outlet: p.branchId?.name ?? '',
    taxable: r2(p.totals?.taxable ?? 0),
    gst: r2(p.totals?.gst ?? 0),
    total: r2(p.totals?.grand ?? 0),
  }));
  const sum = (k) => r2(out.reduce((a, r) => a + r[k], 0));
  return { rows: out, totals: { taxable: sum('taxable'), gst: sum('gst'), total: sum('total'), returned: r2(returned[0]?.total ?? 0), net: r2(sum('total') - (returned[0]?.total ?? 0)) } };
}

/** What was bought from each supplier in the period, after stock sent back. */
export async function supplierwiseReport(opts) {
  const [bought, returned] = await Promise.all([
    Purchase.aggregate([{ $match: purchaseMatch(opts) }, { $group: { _id: '$supplierId', supplier: { $first: '$supplierName' }, invoices: { $sum: 1 }, taxable: { $sum: '$totals.taxable' }, gst: { $sum: '$totals.gst' }, billed: { $sum: '$totals.grand' } } }]),
    PurchaseReturn.aggregate([{ $match: returnMatch(opts) }, { $group: { _id: '$supplierId', supplier: { $first: '$supplierName' }, returned: { $sum: '$total' } } }]),
  ]);
  const by = new Map();
  for (const b of bought) by.set(String(b._id), { supplier: b.supplier, invoices: b.invoices, taxable: b.taxable, gst: b.gst, billed: b.billed, returned: 0 });
  for (const r of returned) {
    const row = by.get(String(r._id)) ?? { supplier: r.supplier, invoices: 0, taxable: 0, gst: 0, billed: 0, returned: 0 };
    row.returned = r.returned;
    by.set(String(r._id), row);
  }
  const out = [...by.values()]
    .map((r) => ({ supplier: r.supplier, invoices: r.invoices, taxable: r2(r.taxable), gst: r2(r.gst), billed: r2(r.billed), returned: r2(r.returned), net: r2(r.billed - r.returned) }))
    .sort((a, b) => b.net - a.net);
  const sum = (k) => r2(out.reduce((a, r) => a + r[k], 0));
  return { rows: out, totals: { invoices: out.reduce((a, r) => a + r.invoices, 0), taxable: sum('taxable'), gst: sum('gst'), billed: sum('billed'), returned: sum('returned'), net: sum('net') } };
}

/** Input GST on purchases per rate (what the shop paid), after stock sent back. */
export async function purchaseGstReport(opts) {
  const [bought, returned] = await Promise.all([
    Purchase.aggregate([{ $match: purchaseMatch(opts) }, { $unwind: '$lines' }, { $group: { _id: '$lines.gstPercent', taxable: { $sum: '$lines.taxable' }, gst: { $sum: '$lines.gst' } } }]),
    PurchaseReturn.aggregate([{ $match: returnMatch(opts) }, { $unwind: '$lines' }, { $group: { _id: '$lines.gstPercent', taxable: { $sum: '$lines.amount' }, gst: { $sum: '$lines.gst' } } }]),
  ]);
  const rates = new Map();
  for (const b of bought) rates.set(b._id ?? 0, { taxable: b.taxable, gst: b.gst });
  for (const r of returned) {
    const cur = rates.get(r._id ?? 0) ?? { taxable: 0, gst: 0 };
    rates.set(r._id ?? 0, { taxable: cur.taxable - r.taxable, gst: cur.gst - r.gst });
  }
  const out = [...rates.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({ rate, taxable: r2(v.taxable), cgst: r2(v.gst / 2), sgst: r2(v.gst / 2), gst: r2(v.gst), total: r2(v.taxable + v.gst) }));
  const sum = (k) => r2(out.reduce((a, r) => a + r[k], 0));
  return { rows: out, totals: { taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), gst: sum('gst'), total: sum('total') } };
}

/**
 * What the shop owes each supplier right now. This is the whole shop (not one outlet) and not a date range:
 * opening balance + invoices - payments - stock sent back.
 */
export async function payablesReport() {
  const all = await listSuppliers({});
  const rows = all
    .filter((s) => Math.abs(s.outstanding) > 0.004)
    .map((s) => ({ supplier: s.name, phone: s.phone ?? '', creditDays: s.creditDays ?? 0, invoices: s.invoices, lastInvoice: isoDay(s.lastInvoiceDate), outstanding: s.outstanding }))
    .sort((a, b) => b.outstanding - a.outstanding);
  return { rows, totals: { suppliers: rows.length, outstanding: r2(rows.reduce((a, r) => a + r.outstanding, 0)) } };
}

/** Udhaar: what customers owe the shop today (whole shop, not by date). */
export async function receivablesReport() {
  const all = await listCustomers({ filter: 'due', limit: 50, page: 1 });
  const page2 = all.total > 50 ? await listCustomers({ filter: 'due', limit: 50, page: 2 }) : { items: [] };
  const rows = [...all.items, ...page2.items].map((c) => ({ customer: c.name, phone: c.phone, creditLimit: c.creditLimit, lastVisit: c.lastVisit ? new Date(c.lastVisit).toISOString().slice(0, 10) : '', owes: c.owes }));
  return { rows, totals: { customers: all.total, owes: all.totalDue } };
}

/**
 * Profit = what was sold (before GST) minus what it cost (the batch's purchase rate, before GST), after returns.
 * The cost is fixed on the bill line when the bill is made. Older bills, made before that, use the batch's purchase rate today.
 * Lines whose batch has no purchase rate (e.g. opening stock entered without one) are shown as "no cost" and left out of profit,
 * so the profit is never overstated by guessing a cost of zero.
 */
function profitPipeline(opts, groupId) {
  const batchRate = { $ifNull: [{ $arrayElemAt: ['$b.purchaseRate', 0] }, 0] };
  const unitsKept = { $subtract: ['$lines.units', '$lines.returnedUnits'] };
  return [
    { $match: { ...scopeOf(opts), ...between(opts.range) } },
    { $unwind: '$lines' },
    { $lookup: { from: 'batches', localField: 'lines.batchId', foreignField: '_id', as: 'b', pipeline: [{ $project: { purchaseRate: 1 } }] } },
    {
      $addFields: {
        rev: { $multiply: ['$lines.taxable', kept] },
        cost: { $multiply: [{ $ifNull: ['$lines.cost', { $multiply: [{ $divide: ['$lines.units', '$lines.unitsPerPack'] }, batchRate] }] }, kept] },
        known: { $ifNull: ['$lines.costKnown', { $gt: [batchRate, 0] }] },
      },
    },
    {
      $group: {
        _id: groupId,
        name: { $first: '$lines.name' },
        unitsPerPack: { $first: '$lines.unitsPerPack' },
        units: { $sum: unitsKept },
        sales: { $sum: '$rev' },
        knownSales: { $sum: { $cond: ['$known', '$rev', 0] } },
        cost: { $sum: { $cond: ['$known', '$cost', 0] } },
      },
    },
  ];
}

const profitRow = (r) => {
  const profit = r.knownSales - r.cost;
  return { sales: r2(r.sales), cost: r2(r.cost), profit: r2(profit), margin: r.knownSales > 0 ? Math.round((profit / r.knownSales) * 1000) / 10 : null, noCost: r2(r.sales - r.knownSales) };
};
const profitTotals = (rows) => {
  const sum = (k) => r2(rows.reduce((s, r) => s + (r[k] ?? 0), 0));
  const known = sum('sales') - sum('noCost');
  return { sales: sum('sales'), cost: sum('cost'), profit: sum('profit'), margin: known > 0 ? Math.round((sum('profit') / known) * 1000) / 10 : 0, noCost: sum('noCost') };
};

/** Profit per medicine, best first. */
export async function profitReport(opts) {
  const rows = await Sale.aggregate([...profitPipeline(opts, '$lines.productId'), { $match: { units: { $gt: 0 } } }, { $sort: { sales: -1 } }, { $limit: 1000 }]);
  const out = rows.map((r) => ({ name: r.name, packs: Math.floor(r.units / r.unitsPerPack), loose: r.units % r.unitsPerPack, ...profitRow(r) })).sort((a, b) => b.profit - a.profit);
  return { rows: out, totals: profitTotals(out) };
}

/** Profit per day. */
export async function profitDaysReport(opts) {
  const rows = await Sale.aggregate([...profitPipeline(opts, dayOf), { $sort: { _id: 1 } }]);
  const out = rows.map((r) => ({ date: r._id, ...profitRow(r) }));
  return { rows: out, totals: profitTotals(out) };
}

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
/** Expenses are dated by day (stored as midnight UTC), so a shop-day range is matched on its first and last date. */
const expenseMatch = (opts) => ({
  status: 'ACTIVE',
  date: { $gte: new Date(`${ymd(opts.range.start)}T00:00:00.000Z`), $lte: new Date(`${ymd(opts.range.end)}T00:00:00.000Z`) },
  // one outlet asked for: that outlet's expenses; otherwise every expense the user may see (shop-wide ones too)
  ...(opts.branchId ? { branchId: oid(opts.branchId) } : opts.branchIds?.length ? { $or: [{ branchId: { $in: opts.branchIds.map(oid) } }, { branchId: null }] } : {}),
});

/** Every expense in the period (cancelled ones are left out). */
export async function expensesReport(opts) {
  const items = await Expense.find(expenseMatch(opts)).sort({ date: 1, createdAt: 1 }).limit(5000).lean();
  const rows = items.map((e) => ({ date: e.date.toISOString().slice(0, 10), category: e.category, note: e.note ?? '', mode: e.mode, amount: r2(e.amount), by: e.createdByName ?? '' }));
  return { rows, totals: { amount: r2(rows.reduce((s, r) => s + r.amount, 0)) } };
}

/** Profit and loss: gross profit from sales, less the expenses, gives what the shop really earned. */
export async function pnlReport(opts) {
  const [profit, expenses] = await Promise.all([profitReport(opts), Expense.aggregate([{ $match: expenseMatch(opts) }, { $group: { _id: '$category', amount: { $sum: '$amount' } } }, { $sort: { amount: -1 } }])]);
  const t = profit.totals;
  const spent = r2(expenses.reduce((s, e) => s + e.amount, 0));
  const rows = [
    { line: 'Sales (before GST)', amount: t.sales },
    { line: 'Cost of the medicines sold', amount: -t.cost },
    { line: 'Gross profit', amount: t.profit, strong: true },
    ...expenses.map((e) => ({ line: 'Expense: ' + e._id, amount: -r2(e.amount) })),
    { line: 'Total expenses', amount: -spent },
    { line: 'Net profit (gross profit minus expenses)', amount: r2(t.profit - spent), strong: true },
  ];
  if (t.noCost > 0) rows.push({ line: 'Not counted: sales whose batch has no purchase rate', amount: t.noCost });
  return { rows, totals: {} };
}
