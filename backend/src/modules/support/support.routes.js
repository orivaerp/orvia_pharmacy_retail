import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { runWithTenant } from '../../plugins/tenantContext.js';
import { audit } from '../audit/audit.model.js';
import { Product, toView } from '../products/product.model.js';
import * as purchasing from '../purchases/purchase.service.js';
import * as stock from '../stock/stock.service.js';
import { Tenant } from '../tenants/tenant.model.js';
import { User } from '../users/user.model.js';
import { SUPPORT_MINUTES, SupportSession } from './support.model.js';

const checkId = (id, what) => {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${what} not found`);
};
const paging = (q) => ({ page: Math.max(1, Number(q.page) || 1), limit: Math.min(50, Math.max(1, Number(q.limit) || 20)) });

// ================================================================== provider side (mounted under /provider)
export const supportRouter = Router();

// start a session: a reason is required, and it is shown to the shop
supportRouter.post(
  '/tenants/:id/support-sessions',
  requirePermission(P.SUPPORT_VIEW),
  validateBody(z.object({ reason: z.string().trim().min(10, 'Please say why you need to look (at least 10 characters)').max(300) })),
  async (req, res) => {
    checkId(req.params.id, 'Shop');
    const tenant = await Tenant.findById(req.params.id).select('name');
    if (!tenant) throw ApiError.notFound('Shop not found');
    const actor = await User.findById(req.user.id).select('name');
    const session = await SupportSession.create({
      tenantId: tenant._id,
      actorId: req.user.id,
      actorName: actor?.name ?? 'Support',
      reason: req.body.reason,
      expiresAt: new Date(Date.now() + SUPPORT_MINUTES * 60 * 1000),
    });
    await audit(req, 'support.start', tenant._id, { reason: req.body.reason, minutes: SUPPORT_MINUTES });
    res.status(201).json({ sessionId: session._id, expiresAt: session.expiresAt, shop: tenant.name });
  },
);

/** Everything under /support/:sid needs a live session that belongs to this very user. */
async function loadSession(req, _res, next) {
  checkId(req.params.sid, 'Support session');
  const s = await SupportSession.findOne({ _id: req.params.sid, actorId: req.user.id });
  if (!s) return next(ApiError.notFound('Support session not found'));
  if (s.endedAt || s.expiresAt <= new Date()) return next(ApiError.forbidden('This support session has ended. Start a new one with a reason.'));
  req.supportSession = s;
  next();
}

/** Counts a look in the session (what was opened, how many times) so the shop's record is complete. */
const touch = (req, area) => SupportSession.updateOne({ _id: req.supportSession._id }, { $inc: { views: 1 }, $addToSet: { areas: area }, $set: { lastViewAt: new Date() } });
const asShop = (req, fn) => runWithTenant(req.supportSession.tenantId, fn);

supportRouter.use('/support/:sid', requirePermission(P.SUPPORT_VIEW), loadSession);

supportRouter.get('/support/:sid', (req, res) => {
  const s = req.supportSession;
  res.json({ sessionId: s._id, tenantId: s.tenantId, reason: s.reason, startedAt: s.startedAt, expiresAt: s.expiresAt, views: s.views });
});

supportRouter.post('/support/:sid/end', async (req, res) => {
  await SupportSession.updateOne({ _id: req.supportSession._id }, { $set: { endedAt: new Date() } });
  await audit(req, 'support.end', req.supportSession.tenantId, { views: req.supportSession.views });
  res.json({ ended: true });
});

// ---- read-only data (there is deliberately no write route here) ----
supportRouter.get('/support/:sid/suppliers', async (req, res) => {
  await touch(req, 'suppliers');
  res.json(await asShop(req, () => purchasing.listSuppliers({ q: req.query.q?.toString() })));
});

supportRouter.get('/support/:sid/suppliers/:supplierId', async (req, res) => {
  checkId(req.params.supplierId, 'Supplier');
  await touch(req, 'suppliers');
  res.json(await asShop(req, () => purchasing.supplierLedger(req.params.supplierId)));
});

supportRouter.get('/support/:sid/purchases', async (req, res) => {
  await touch(req, 'purchases');
  const { supplierId, q } = req.query;
  if (supplierId) checkId(supplierId, 'Supplier');
  res.json(await asShop(req, () => purchasing.listPurchases({ supplierId: supplierId?.toString(), q: q?.toString(), ...paging(req.query) })));
});

supportRouter.get('/support/:sid/purchases/:purchaseId', async (req, res) => {
  checkId(req.params.purchaseId, 'Purchase');
  await touch(req, 'purchases');
  res.json(await asShop(req, () => purchasing.getPurchase(req.params.purchaseId)));
});

supportRouter.get('/support/:sid/stock', async (req, res) => {
  await touch(req, 'stock');
  const { q, filter } = req.query;
  res.json(await asShop(req, () => stock.stockSummary({ q: q?.toString(), filter: filter?.toString(), ...paging(req.query) })));
});

supportRouter.get('/support/:sid/stock-history', async (req, res) => {
  await touch(req, 'stock history');
  const type = req.query.type?.toString();
  res.json(await asShop(req, () => stock.recentLedger({ type, limit: Math.min(200, Number(req.query.limit) || 50) })));
});

supportRouter.get('/support/:sid/products', async (req, res) => {
  await touch(req, 'products');
  const { page, limit } = paging(req.query);
  // await INSIDE the shop context: a bare query would run after it has closed
  const items = await asShop(req, async () => await Product.find().populate('masterId').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit));
  const total = await asShop(req, async () => await Product.countDocuments());
  res.json({ items: items.map(toView), total, page, limit });
});

// ================================================================== shop side (mounted under /support-access)
export const supportAccessRouter = Router();
supportAccessRouter.use(requireTenant);

// the owner can always see who looked at the shop's data, why, when and what they opened
supportAccessRouter.get('/', requirePermission(P.USER_MANAGE), async (req, res) => {
  const sessions = await SupportSession.find({ tenantId: req.user.tenantId }).sort({ startedAt: -1 }).limit(100).lean();
  const now = Date.now();
  res.json(
    sessions.map((s) => ({
      _id: s._id,
      by: s.actorName,
      reason: s.reason,
      startedAt: s.startedAt,
      endedAt: s.endedAt ?? (s.expiresAt.getTime() < now ? s.expiresAt : null),
      active: !s.endedAt && s.expiresAt.getTime() > now,
      views: s.views,
      areas: s.areas,
    })),
  );
});
