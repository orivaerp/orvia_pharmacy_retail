import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { Branch } from '../branches/branch.model.js';
import { CustomerPayment } from '../customers/customer.model.js';
import { SupplierPayment } from '../purchases/purchase.model.js';
import { Sale, SaleReturn } from '../sales/sale.model.js';
import { dayRange } from '../sales/report.service.js';
import { CashClose, Expense } from './account.model.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const oid = (id) => new mongoose.Types.ObjectId(id);
export const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Cash that came in and went out of one outlet between two days (India time), by source. */
async function movements(branchId, from, to) {
  const { start, end } = dayRange(from, to);
  const dStart = new Date(`${from}T00:00:00.000Z`);
  const dEnd = new Date(`${to}T23:59:59.999Z`);
  // payments and expenses that were not tied to an outlet belong to a shop with one outlet; with several they are only counted as a warning
  const outlets = await Branch.countDocuments({ isActive: true });
  const single = outlets <= 1;
  const mine = single ? { $or: [{ branchId: oid(branchId) }, { branchId: null }] } : { branchId: oid(branchId) };
  const dated = (field) => ({ [field]: { $gte: dStart, $lte: dEnd } });

  const [bySale, byRefund, received, spent, supplier, unallocated] = await Promise.all([
    Sale.aggregate([{ $match: { branchId: oid(branchId), createdAt: { $gte: start, $lte: end } } }, { $unwind: '$payments' }, { $group: { _id: '$payments.mode', amount: { $sum: '$payments.amount' } } }]),
    SaleReturn.aggregate([{ $match: { branchId: oid(branchId), createdAt: { $gte: start, $lte: end }, refundMode: 'CASH' } }, { $group: { _id: null, amount: { $sum: '$refund' } } }]),
    CustomerPayment.aggregate([{ $match: { ...mine, ...dated('receivedOn'), mode: 'CASH' } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    Expense.aggregate([{ $match: { ...mine, ...dated('date'), mode: 'CASH', status: 'ACTIVE' } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    SupplierPayment.aggregate([{ $match: { ...mine, ...dated('paidOn'), mode: 'CASH' } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    single
      ? 0
      : Promise.all([
          CustomerPayment.countDocuments({ branchId: null, mode: 'CASH', ...dated('receivedOn') }),
          Expense.countDocuments({ branchId: null, mode: 'CASH', status: 'ACTIVE', ...dated('date') }),
          SupplierPayment.countDocuments({ branchId: null, mode: 'CASH', ...dated('paidOn') }),
        ]).then((c) => c.reduce((s, n) => s + n, 0)),
  ]);
  const mode = (m) => r2(bySale.find((x) => x._id === m)?.amount ?? 0);
  return {
    cashSales: mode('CASH'),
    cashRefunds: r2(byRefund[0]?.amount ?? 0),
    cashReceived: r2(received[0]?.amount ?? 0),
    cashExpenses: r2(spent[0]?.amount ?? 0),
    supplierCash: r2(supplier[0]?.amount ?? 0),
    nonCash: { upi: mode('UPI'), card: mode('CARD'), credit: mode('CREDIT') },
    unallocated,
  };
}

const expectedOf = (opening, m) => r2(opening + m.cashSales - m.cashRefunds + m.cashReceived - m.cashExpenses - m.supplierCash);

/** What the drawer should hold for this outlet at the end of `date`, and how that is made up. Reads only. */
export async function closePreview(branchId, date) {
  if (!isDay(date)) throw ApiError.badRequest('Choose a valid date');
  if (date > todayIst()) throw ApiError.badRequest('You cannot close a day that has not happened yet');
  const branch = await Branch.findById(branchId);
  if (!branch) throw ApiError.notFound('Outlet not found');
  const previous = await CashClose.findOne({ branchId, date: { $lt: date }, supersededAt: null }).sort({ date: -1 }).lean();
  const later = await CashClose.findOne({ branchId, date: { $gt: date }, supersededAt: null }).sort({ date: 1 }).lean();
  const existing = await CashClose.findOne({ branchId, date, supersededAt: null }).lean();
  const from = previous ? addDays(previous.date, 1) : date;
  const m = await movements(branchId, from, date);
  const opening = previous ? previous.leftover : null; // null: the first close for this outlet, the owner says what was in the drawer
  return {
    outlet: { _id: branch._id, name: branch.name },
    date,
    from,
    daysCovered: Math.round((Date.parse(date) - Date.parse(from)) / 86_400_000) + 1,
    previous: previous ? { date: previous.date, leftover: previous.leftover } : null,
    locked: Boolean(later), // a later day is already closed, so this one can no longer change
    laterClose: later ? later.date : null,
    existing: existing ? { _id: existing._id, counted: existing.counted, difference: existing.difference, withdrawn: existing.withdrawn, note: existing.note, closedByName: existing.closedByName, at: existing.createdAt } : null,
    opening,
    ...m,
    expected: opening === null ? null : expectedOf(opening, m),
    expectedWithoutOpening: expectedOf(0, m),
  };
}

export async function closeDay(user, { branchId, date, counted, withdrawn = 0, openingCash, note }) {
  const p = await closePreview(branchId, date);
  if (p.locked) throw ApiError.conflict(`${p.laterClose} is already closed after this day, so ${date} cannot be changed. Close days in order.`);
  let opening = p.opening;
  if (opening === null) {
    if (openingCash === undefined) throw ApiError.badRequest('This is the first day closed for this outlet. Say how much cash was in the drawer at the start.');
    opening = r2(openingCash);
  }
  if (withdrawn > counted + 0.001) throw ApiError.badRequest('You cannot take out more cash than you counted');
  const expected = expectedOf(opening, p);
  const doc = await CashClose.create({
    branchId,
    date,
    from: p.from,
    opening,
    cashSales: p.cashSales,
    cashRefunds: p.cashRefunds,
    cashReceived: p.cashReceived,
    cashExpenses: p.cashExpenses,
    supplierCash: p.supplierCash,
    expected,
    counted: r2(counted),
    difference: r2(counted - expected),
    withdrawn: r2(withdrawn),
    leftover: r2(counted - withdrawn),
    note,
    nonCash: p.nonCash,
    closedBy: user.id,
    closedByName: user.name,
  });
  await CashClose.updateMany({ branchId, date, _id: { $ne: doc._id }, supersededAt: null }, { $set: { supersededAt: new Date() } });
  return { ...doc.toObject(), replaced: Boolean(p.existing) };
}

export async function closeHistory(branchId) {
  return CashClose.find({ branchId, supersededAt: null }).sort({ date: -1 }).limit(60).lean();
}
