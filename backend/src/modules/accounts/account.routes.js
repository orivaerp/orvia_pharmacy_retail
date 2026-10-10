import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { assertBranchAllowed, branchScope, requireAny, requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import { User } from '../users/user.model.js';
import { EXPENSE_CATEGORIES, EXPENSE_MODES, Expense } from './account.model.js';
import * as cash from './cash.service.js';

/** Expenses and the end-of-day cash count. Both are money decisions: owner and managers (purchase.approve). */
export const expenseRouter = Router();
export const cashRouter = Router();
expenseRouter.use(requireTenant);
cashRouter.use(requireTenant);

const oidOk = (v) => mongoose.isValidObjectId(v);
const objectId = z.string().refine(oidOk, 'Invalid id');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Choose a valid date');
const money = z.number().min(0).max(100_000_000);
const manage = requirePermission(P.PURCHASE_APPROVE);
const nameOf = async (req) => (await User.findById(req.user.id).select('name').lean())?.name ?? '';

// ------------------------------------------------------------------ expenses
expenseRouter.get('/', requireAny(P.PURCHASE_APPROVE, P.REPORTS_VIEW), async (req, res) => {
  const today = cash.todayIst();
  const from = cash.isDay(req.query.from) ? req.query.from : `${today.slice(0, 8)}01`;
  const to = cash.isDay(req.query.to) ? req.query.to : today;
  if (from > to) throw ApiError.badRequest('The start date is after the end date');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw ApiError.badRequest('Please choose a range of up to one year');
  const filter = { date: { $gte: new Date(`${from}T00:00:00.000Z`), $lte: new Date(`${to}T00:00:00.000Z`) } };
  const branchId = req.query.branchId?.toString();
  if (branchId) {
    if (!oidOk(branchId)) throw ApiError.notFound('Outlet not found');
    assertBranchAllowed(req, branchId);
    filter.branchId = branchId;
  } else if (branchScope(req)?.length) {
    // staff limited to some outlets see those outlets' expenses and the shop-wide ones
    filter.$or = [{ branchId: { $in: branchScope(req) } }, { branchId: null }];
  }
  if (req.query.category) filter.category = req.query.category.toString();
  const items = await Expense.find(filter).sort({ date: -1, createdAt: -1 }).limit(1000).lean();
  const live = items.filter((e) => e.status === 'ACTIVE');
  const byCategory = {};
  for (const e of live) byCategory[e.category] = Math.round(((byCategory[e.category] ?? 0) + e.amount) * 100) / 100;
  return res.json({
    items,
    from,
    to,
    total: Math.round(live.reduce((s, e) => s + e.amount, 0) * 100) / 100,
    byCategory,
    categories: EXPENSE_CATEGORIES,
    modes: EXPENSE_MODES,
  });
});

expenseRouter.post(
  '/',
  manage,
  validateBody(z.object({ date: day, category: z.enum(EXPENSE_CATEGORIES), amount: z.number().min(0.01).max(100_000_000), mode: z.enum(EXPENSE_MODES).default('CASH'), note: z.string().trim().max(200).optional(), branchId: objectId.optional() })),
  async (req, res) => {
    if (req.body.date > cash.todayIst()) throw ApiError.badRequest('An expense cannot be dated in the future');
    if (req.body.branchId) assertBranchAllowed(req, req.body.branchId);
    const e = await Expense.create({
      ...req.body,
      amount: Math.round(req.body.amount * 100) / 100,
      date: new Date(`${req.body.date}T00:00:00.000Z`),
      createdBy: req.user.id,
      createdByName: await nameOf(req),
    });
    await audit(req, 'expense.create', req.user.tenantId, { category: e.category, amount: e.amount, mode: e.mode });
    res.status(201).json(e);
  },
);

expenseRouter.post('/:id/void', manage, validateBody(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(200) })), async (req, res) => {
  if (!oidOk(req.params.id)) throw ApiError.notFound('Expense not found');
  const e = await Expense.findById(req.params.id);
  if (!e) throw ApiError.notFound('Expense not found');
  if (e.status === 'VOID') throw ApiError.conflict('This expense is already cancelled');
  e.status = 'VOID';
  e.voidedAt = new Date();
  e.voidReason = req.body.reason;
  e.voidedByName = await nameOf(req);
  await e.save();
  await audit(req, 'expense.void', req.user.tenantId, { category: e.category, amount: e.amount, reason: req.body.reason });
  // a cash count already saved for that day (or later) is a record of what was counted, so it is left as it was; the owner is told
  let warning;
  if (e.mode === 'CASH') {
    const { CashClose } = await import('./account.model.js');
    const closed = await CashClose.findOne({ date: { $gte: e.date.toISOString().slice(0, 10) }, supersededAt: null, ...(e.branchId && { branchId: e.branchId }) }).select('date').lean();
    if (closed) warning = `Cash was already counted on ${closed.date}. That count is not changed. If this money was never really spent, that day showed a shortage of this amount.`;
  }
  res.json({ ...e.toObject(), warning });
});

// ------------------------------------------------------------------ cash close
const outlet = (req) => {
  const id = req.query.branchId?.toString() ?? req.body?.branchId;
  if (!id || !oidOk(id)) throw ApiError.badRequest('Choose an outlet');
  assertBranchAllowed(req, id);
  return id;
};

cashRouter.get('/close', manage, async (req, res) => {
  res.json(await cash.closePreview(outlet(req), req.query.date?.toString() ?? cash.todayIst()));
});

cashRouter.get('/history', manage, async (req, res) => {
  res.json(await cash.closeHistory(outlet(req)));
});

cashRouter.post('/close', manage, validateBody(z.object({ branchId: objectId, date: day, counted: money, withdrawn: money.default(0), openingCash: money.optional(), note: z.string().trim().max(300).optional() })), async (req, res) => {
  const id = outlet(req);
  const me = { id: req.user.id, name: await nameOf(req) };
  const r = await cash.closeDay(me, { ...req.body, branchId: id });
  await audit(req, 'cash.close', req.user.tenantId, { date: r.date, expected: r.expected, counted: r.counted, difference: r.difference, withdrawn: r.withdrawn, replaced: r.replaced });
  res.status(201).json(r);
});
