import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { audit } from '../audit/audit.model.js';
import { Tenant } from './tenant.model.js';

/** The shop's own details, shown on bills and emails. Only the owner side (user.manage) can change them. */
const router = Router();
router.use(requireTenant);

const view = (t) => ({ name: t.name, phone: t.phone ?? '', address: t.address ?? '', gstin: t.gstin ?? '', drugLicenseNo: t.drugLicenseNo ?? '', lowStockDefault: t.lowStockDefault ?? 5 });
const blank = (s) => z.string().trim().max(s).optional();

router.get('/', async (req, res) => res.json(view(await Tenant.findById(req.user.tenantId).lean())));

router.patch(
  '/',
  requirePermission(P.USER_MANAGE),
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      phone: z.string().trim().regex(/^(\d{10})?$/, 'Phone must be 10 digits').optional(),
      address: blank(300),
      gstin: z.string().trim().toUpperCase().regex(/^([0-9]{2}[A-Z0-9]{13})?$/, 'GSTIN must be 15 letters and digits').optional(),
      drugLicenseNo: blank(60),
      lowStockDefault: z.number().int().min(0).max(100000).optional(),
    }),
    { onlyGiven: true },
  ),
  async (req, res) => {
    await Tenant.updateOne({ _id: req.user.tenantId }, { $set: req.body });
    await audit(req, 'shop.update', req.user.tenantId, { changes: Object.keys(req.body) });
    res.json(view(await Tenant.findById(req.user.tenantId).lean()));
  },
);

export default router;
