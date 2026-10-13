import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import * as meds from './medicine.service.js';
import { medicinePatchSchema, medicineSchema } from './medicine.schema.js';
import * as requests from './request.service.js';

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const paging = (q) => ({ page: Math.max(1, Number(q.page) || 1), limit: Math.min(100, Math.max(1, Number(q.limit) || 20)) });
const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Not found');
};

// ---- /provider/medicines (mounted by provider.routes.js; platform-only is enforced there) ----
export const medicineRouter = Router();

medicineRouter.get('/', requirePermission(P.TENANT_VIEW), async (req, res) => {
  const { q, form, status, schedule, manufacturer } = req.query;
  res.json(await meds.listMedicines({ q: q?.toString(), form: form?.toString(), status: status?.toString(), schedule: schedule?.toString(), manufacturer: manufacturer?.toString() }, paging(req.query)));
});

medicineRouter.get('/manufacturers', requirePermission(P.TENANT_VIEW), async (req, res) => {
  res.json(await meds.listManufacturers(req.query.q?.toString()));
});

medicineRouter.post('/', requirePermission(P.MEDICINE_MANAGE), validateBody(medicineSchema), async (req, res) => {
  const medicine = await meds.createMedicine(req.body);
  await audit(req, 'medicine.create', undefined, { name: medicine.name });
  res.status(201).json(medicine);
});

// dry-run first (default), then the same call with dryRun:false to really import
medicineRouter.post(
  '/import',
  requirePermission(P.MEDICINE_MANAGE),
  validateBody(
    z.object({
      csv: z.string().min(10).max(2_000_000),
      dryRun: z.boolean().default(true),
      // used only for supplier-style lists that lack these columns
      defaults: z
        .object({
          manufacturer: z.string().trim().max(120).optional(),
          hsn: z.string().trim().regex(/^(\d{4,8})?$/).optional(),
          gstPercent: z.number().refine((v) => [0, 5, 12, 18, 28].includes(v)).optional(),
        })
        .default({}),
    }),
  ),
  async (req, res) => {
    const result = await meds.importMedicines(req.body.csv, { dryRun: req.body.dryRun, defaults: req.body.defaults });
    if (!result.dryRun) await audit(req, 'medicine.import', undefined, { created: result.created, skipped: result.duplicates.length + result.errors.length });
    res.json(result);
  },
);

// verify / deactivate many at once (by ticked ids, or everything matching the current filter)
medicineRouter.post(
  '/bulk-status',
  requirePermission(P.MEDICINE_MANAGE),
  validateBody(
    z.object({
      status: z.enum(['verified', 'pending', 'inactive']),
      ids: z.array(objectId).max(1000).optional(),
      filter: z.object({ q: z.string().optional(), form: z.string().optional(), status: z.string().optional(), schedule: z.string().optional(), manufacturer: z.string().optional() }).optional(),
    }),
  ),
  async (req, res) => {
    if (!req.body.ids?.length && !req.body.filter) throw ApiError.badRequest('Choose medicines (ids) or a filter');
    const result = await meds.bulkSetStatus(req.body);
    await audit(req, 'medicine.bulk_status', undefined, { status: req.body.status, updated: result.updated });
    res.json(result);
  },
);

medicineRouter.get('/:id/substitutes', requirePermission(P.TENANT_VIEW), async (req, res) => {
  checkId(req.params.id);
  res.json(await meds.substitutesOf(req.params.id, { verifiedOnly: false }));
});

medicineRouter.patch('/:id', requirePermission(P.MEDICINE_MANAGE), validateBody(medicinePatchSchema, { onlyGiven: true }), async (req, res) => {
  checkId(req.params.id);
  const medicine = await meds.updateMedicine(req.params.id, req.body);
  await audit(req, 'medicine.update', undefined, { name: medicine.name, changes: Object.keys(req.body) });
  res.json(medicine);
});

// ---- /provider/medicine-requests ----
export const requestRouter = Router();

requestRouter.get('/', requirePermission(P.TENANT_VIEW), async (req, res) => {
  res.json(await requests.listRequests({ status: req.query.status?.toString() || 'pending', ...paging(req.query) }));
});

requestRouter.post('/:id/approve', requirePermission(P.MEDICINE_MANAGE), validateBody(medicineSchema), async (req, res) => {
  checkId(req.params.id);
  const result = await requests.approveRequest(req.params.id, req.body, req.user.id);
  await audit(req, 'medicine.request.approve', result.request.tenantId, { name: result.medicine.name });
  res.json(result);
});

requestRouter.post('/:id/merge', requirePermission(P.MEDICINE_MANAGE), validateBody(z.object({ medicineId: objectId })), async (req, res) => {
  checkId(req.params.id);
  const result = await requests.mergeRequest(req.params.id, req.body.medicineId, req.user.id);
  await audit(req, 'medicine.request.merge', result.request.tenantId, { medicine: result.medicine.name });
  res.json(result);
});

requestRouter.post('/:id/reject', requirePermission(P.MEDICINE_MANAGE), validateBody(z.object({ note: z.string().trim().min(3).max(300) })), async (req, res) => {
  checkId(req.params.id);
  const result = await requests.rejectRequest(req.params.id, req.body.note, req.user.id);
  await audit(req, 'medicine.request.reject', result.request.tenantId, { note: req.body.note });
  res.json(result);
});
