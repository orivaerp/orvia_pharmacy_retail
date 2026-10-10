import { Router } from 'express';
import mongoose from 'mongoose';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { requirePermission, requireTenant } from '../../middleware/auth.js';
import { Customer } from '../customers/customer.model.js';
import { Product, toView } from '../products/product.model.js';
import { Supplier } from '../purchases/purchase.model.js';
import { User } from '../users/user.model.js';
import { AuditLog } from './audit.model.js';
import { AREAS, EVENTS, actionsIn } from './activity.labels.js';

/**
 * "Who did what" for the shop owner: this shop's audit trail in plain words. Read only; nothing here can be changed or removed.
 * Only the owner (user.manage) sees it, because it shows what every member of staff did.
 */
const router = Router();
router.use(requireTenant, requirePermission(P.USER_MANAGE));

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');

router.get('/', async (req, res) => {
  const q = req.query;
  const area = q.area?.toString();
  const filter = { tenantId: new mongoose.Types.ObjectId(req.user.tenantId), action: { $in: actionsIn(AREAS[area] ? area : undefined) } };
  if (q.userId && mongoose.isValidObjectId(q.userId)) filter.actorId = new mongoose.Types.ObjectId(q.userId.toString());
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const from = isDay(q.from) ? q.from : null;
  const to = isDay(q.to) ? q.to : today;
  filter.at = { $lte: new Date(`${to}T23:59:59.999+05:30`) };
  if (from) filter.at.$gte = new Date(`${from}T00:00:00+05:30`);

  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const [rows, total] = await Promise.all([AuditLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditLog.countDocuments(filter)]);

  // names for the ids inside the events (a customer, a supplier, a product), one lookup each
  const ids = (key) => [...new Set(rows.map((r) => r.meta?.[key]).filter((v) => mongoose.isValidObjectId(v)))];
  const [people, customers, suppliers, products] = await Promise.all([
    User.find({ _id: { $in: [...new Set(rows.map((r) => r.actorId).filter(Boolean).map(String))] } }).select('name role tenantId').lean(),
    Customer.find({ _id: { $in: ids('customerId') } }).select('name').lean(),
    Supplier.find({ _id: { $in: ids('supplierId') } }).select('name').lean(),
    Product.find({ _id: { $in: ids('productId') } }).populate('masterId').lean(),
  ]);
  const byId = (list, f = (x) => x.name) => new Map(list.map((x) => [String(x._id), f(x)]));
  const who = byId(people, (u) => ({ name: u.name, role: u.role, platform: !u.tenantId }));
  const cust = byId(customers);
  const supp = byId(suppliers);
  const prod = byId(products, (p) => {
    try {
      return toView(p).name;
    } catch {
      return p.name;
    }
  });

  res.json({
    items: rows.map((r) => {
      const ev = EVENTS[r.action];
      const m = r.meta ?? {};
      const names = { customer: cust.get(String(m.customerId)), supplier: supp.get(String(m.supplierId)), product: prod.get(String(m.productId)) };
      const a = r.actorId ? who.get(String(r.actorId)) : null;
      return {
        _id: r._id,
        at: r.at,
        area: ev.area,
        action: r.action,
        text: ev.text(m, names),
        who: a ? { name: a.name, role: a.role, orvia: a.platform } : null,
        ip: r.action === 'auth.login' ? r.ip ?? null : null,
      };
    }),
    total,
    page,
    limit,
    from,
    to,
    areas: AREAS,
  });
});

export default router;
