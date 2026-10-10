import { Router } from 'express';
import mongoose from 'mongoose';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { assertBranchAllowed, branchScope, requirePermission, requireTenant } from '../../middleware/auth.js';
import { ApiError } from '../../utils/ApiError.js';
import { hasFeature } from '../plans/plan.service.js';
import * as svc from './report.service.js';

const router = Router();
router.use(requireTenant, requirePermission(P.REPORTS_VIEW));

const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v : null);
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const REPORTS = {
  sales: svc.salesReport,
  gst: svc.gstReport,
  items: svc.itemsReport,
  register: svc.registerReport,
  expiry: svc.expiryReport,
  lowstock: svc.lowStockReport,
  purchases: svc.purchasesReport,
  supplierwise: svc.supplierwiseReport,
  purchasegst: svc.purchaseGstReport,
  payables: svc.payablesReport,
  receivables: svc.receivablesReport,
  profit: svc.profitReport,
  profitdays: svc.profitDaysReport,
  expenses: svc.expensesReport,
  pnl: svc.pnlReport,
};

// reports that need the plan's GST reports feature
const NEEDS_FEATURE = { gst: 'gstReports', purchasegst: 'gstReports' };

router.get('/:name', async (req, res) => {
  const run = REPORTS[req.params.name];
  if (!run) throw ApiError.notFound('Report not found');
  if (NEEDS_FEATURE[req.params.name] && !(await hasFeature(req.user.tenantId, NEEDS_FEATURE[req.params.name]))) throw ApiError.forbidden('GST reports are not included in your plan. Upgrade to use them.');

  const branchId = req.query.branchId?.toString();
  if (branchId) {
    if (!mongoose.isValidObjectId(branchId)) throw ApiError.notFound('Outlet not found');
    assertBranchAllowed(req, branchId);
  }
  const today = todayIst();
  const from = day(req.query.from?.toString()) ?? `${today.slice(0, 8)}01`;
  const to = day(req.query.to?.toString()) ?? today;
  if (from > to) throw ApiError.badRequest('The start date is after the end date');
  const span = (new Date(to) - new Date(from)) / 86_400_000;
  if (span > 366) throw ApiError.badRequest('Please choose a range of up to one year');

  const days = req.query.days === undefined ? 90 : Math.min(365, Math.max(0, Number(req.query.days) || 0));
  const result = await run({ branchId, branchIds: branchScope(req), range: svc.dayRange(from, to), days });
  res.json({ ...result, from, to });
});

export default router;
