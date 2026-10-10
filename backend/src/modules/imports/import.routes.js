import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { assertBranchAllowed, requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { audit } from '../audit/audit.model.js';
import { analysePeople, commitPeople, previewPeople } from './people-import.service.js';
import * as stockImport from './stock-import.service.js';

/** Bring a shop's existing data in from a spreadsheet. The sheet is read in the browser; these routes get plain rows. */
const router = Router();
router.use(requireTenant);

const body = z.object({
  branchId: z.string().refine((v) => mongoose.isValidObjectId(v), 'Choose an outlet'),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]).optional())).min(1).max(stockImport.MAX_ROWS),
  confirmAdd: z.boolean().optional(),
});
const canImport = [requirePermission(P.PRODUCT_MANAGE), requirePermission(P.INVENTORY_ADJUST)];

// products and opening stock
router.post('/stock/preview', ...canImport, validateBody(body), async (req, res) => {
  assertBranchAllowed(req, req.body.branchId);
  res.json(stockImport.previewOf(await stockImport.analyse(req.user, req.body)));
});

router.post('/stock', ...canImport, validateBody(body), async (req, res) => {
  assertBranchAllowed(req, req.body.branchId);
  const r = await stockImport.commit(req.user, req.body);
  await audit(req, 'import.stock', req.user.tenantId, { outlet: r.outlet, products: r.productsAdded, rows: r.stockRows, packs: r.packs, skipped: r.skipped.length, failed: r.failed.length });
  res.status(201).json(r);
});

// customers (with what they owe) and suppliers. Opening balances are money, so owner and managers only (purchase.approve).
const peopleBody = z.object({ rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]).optional())).min(1).max(stockImport.MAX_ROWS) });
const PEOPLE = {
  customers: [requirePermission(P.SALES_CREATE), requirePermission(P.PURCHASE_APPROVE)],
  suppliers: [requirePermission(P.PURCHASE_CREATE), requirePermission(P.PURCHASE_APPROVE)],
};
for (const [kind, guards] of Object.entries(PEOPLE)) {
  router.post(`/${kind}/preview`, ...guards, validateBody(peopleBody), async (req, res) => {
    res.json(previewPeople(await analysePeople(kind, req.body)));
  });
  router.post(`/${kind}`, ...guards, validateBody(peopleBody), async (req, res) => {
    const r = await commitPeople(kind, req.user, req.body);
    await audit(req, `import.${kind}`, req.user.tenantId, { created: r.created, existing: r.skippedExisting, skipped: r.skipped.length, opening: r.openingTotal });
    res.status(201).json(r);
  });
}

export default router;
