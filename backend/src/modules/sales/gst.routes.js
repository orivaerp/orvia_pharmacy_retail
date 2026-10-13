import { Router } from 'express';
import mongoose from 'mongoose';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { assertBranchAllowed, branchScope, requirePermission, requireTenant } from '../../middleware/auth.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import { hasFeature } from '../plans/plan.service.js';
import * as gst from './gst-filing.service.js';
import { Sale, SaleReturn } from './sale.model.js';

/** GST filing helpers (reports.view + the plan's GST reports feature). Nothing here is sent to the GST portal: the files are downloaded and uploaded by the owner. */
const router = Router();
router.use(requireTenant, requirePermission(P.REPORTS_VIEW));
router.use(async (req, _res, next) => {
  if (!(await hasFeature(req.user.tenantId, 'gstReports'))) throw ApiError.forbidden('GST filing files are not included in your plan. Upgrade to use them.');
  next();
});

const optsOf = (req) => {
  const branchId = req.query.branchId?.toString();
  if (branchId) {
    if (!mongoose.isValidObjectId(branchId)) throw ApiError.notFound('Outlet not found');
    assertBranchAllowed(req, branchId);
  }
  return { tenantId: req.user.tenantId, branchId, branchIds: branchScope(req) };
};
const monthOf = (req) => req.query.month?.toString() ?? '';

const download = (res, name, type, body) => {
  res.setHeader('Content-Type', `${type}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(body);
};
const downloadJson = (res, name, obj) => download(res, name, 'application/json', JSON.stringify(obj, null, 2));

router.get('/gstr1', async (req, res) => res.json(await gst.gstr1(optsOf(req), monthOf(req))));

router.get('/gstr1/json', async (req, res) => {
  const f = await gst.gstr1(optsOf(req), monthOf(req));
  await audit(req, 'gst.export', req.user.tenantId, { what: 'gstr1-json', month: f.month });
  downloadJson(res, `GSTR1_${f.gstin || 'shop'}_${f.fp}.json`, gst.gstr1PortalJson(f));
});

router.get('/gstr1/csv/:table', async (req, res) => {
  const f = await gst.gstr1(optsOf(req), monthOf(req));
  const csv = gst.gstr1Csv(f, req.params.table);
  await audit(req, 'gst.export', req.user.tenantId, { what: `gstr1-${req.params.table}`, month: f.month });
  download(res, `GSTR1_${req.params.table}_${f.month}.csv`, 'text/csv', csv);
});

router.get('/gstr3b', async (req, res) => res.json(await gst.gstr3b(optsOf(req), monthOf(req))));

router.get('/gstr3b/json', async (req, res) => {
  const f = await gst.gstr3b(optsOf(req), monthOf(req));
  await audit(req, 'gst.export', req.user.tenantId, { what: 'gstr3b-json', month: f.month });
  downloadJson(res, `GSTR3B_${f.gstin || 'shop'}_${f.fp}.json`, gst.gstr3bPortalJson(f));
});

// ---- e-invoice files for the IRP portal ----
router.get('/einvoice/sale/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Bill not found');
  const sale = await Sale.findById(req.params.id).lean();
  if (!sale) throw ApiError.notFound('Bill not found');
  assertBranchAllowed(req, String(sale.branchId));
  const doc = await gst.einvoiceForSale(sale);
  await audit(req, 'gst.einvoice', req.user.tenantId, { number: sale.number });
  downloadJson(res, `einvoice_${sale.number}.json`, [doc]);
});

router.get('/einvoice/return/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Return not found');
  const ret = await SaleReturn.findById(req.params.id).lean();
  if (!ret) throw ApiError.notFound('Return not found');
  assertBranchAllowed(req, String(ret.branchId));
  const doc = await gst.einvoiceForReturn(ret);
  await audit(req, 'gst.einvoice', req.user.tenantId, { number: ret.number });
  downloadJson(res, `einvoice_${ret.number}.json`, [doc]);
});

/** What can be made for a month, so the screen can show the bills that still need details before the file is downloaded. */
router.get('/einvoice', async (req, res) => {
  const r = await gst.einvoicesForMonth(optsOf(req), monthOf(req));
  res.json({ total: r.total, ready: r.invoices.length, failed: r.failed });
});

router.get('/einvoice/month', async (req, res) => {
  const r = await gst.einvoicesForMonth(optsOf(req), monthOf(req));
  if (!r.invoices.length) throw ApiError.badRequest('No B2B bill of this month is ready for an e-invoice file.');
  await audit(req, 'gst.einvoice', req.user.tenantId, { month: monthOf(req), count: r.invoices.length });
  downloadJson(res, `einvoice_${monthOf(req)}.json`, r.invoices);
});

export default router;
