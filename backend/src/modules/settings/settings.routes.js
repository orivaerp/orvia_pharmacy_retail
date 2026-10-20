import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { audit } from '../audit/audit.model.js';
import { FIELDS, envDefaults, savedSettings, saveSettings, settings } from './settings.service.js';

/** Provider > Settings. Super admin only. */
export const settingsRouter = Router();
settingsRouter.use(requirePermission(P.PLATFORM_USERS_MANAGE));

const view = () => ({ saved: savedSettings(), inUse: settings(), defaults: envDefaults() });

settingsRouter.get('/', (_req, res) => res.json(view()));

const text = (max) => z.string().trim().max(max);
const body = z
  .object({
    companyName: z.union([text(120).min(2), z.literal('')]),
    companyAddress: text(300),
    companyGstin: z.string().trim().toUpperCase().regex(/^([0-9]{2}[A-Z0-9]{13})?$/, 'GSTIN must be 15 letters and digits'),
    bankDetails: text(300),
    companyPan: z.string().trim().toUpperCase().regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, 'PAN must look like ABCDE1234F'),
    companyPhone: text(30),
    companyEmail: z.union([z.email(), z.literal('')]),
    companyWebsite: text(120),
    companyLogo: z.union([z.string().max(300_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'The logo must be a PNG or JPG'), z.literal('')]),
    invoiceNote: text(200),
    invoiceTerms: text(600),
    invoiceLayout: z.enum(['', 'classic', 'modern', 'compact']),
    invoiceAccent: z.string().trim().regex(/^(#[0-9a-fA-F]{6})?$/, 'Pick a colour like #0b3d3a'),
    billingGstPercent: z.number().min(0).max(40).nullable(),
    billingGraceDays: z.number().int().min(0).max(60).nullable(),
    signupTrialDays: z.number().int().min(0).max(90).nullable(),
    supportEmail: z.union([z.email(), z.literal('')]),
    supportPhone: text(30),
    grievanceName: text(80),
    grievanceEmail: z.union([z.email(), z.literal('')]),
  })
  .partial();

settingsRouter.patch('/', validateBody(body, { onlyGiven: true }), async (req, res) => {
  const changed = FIELDS.filter((k) => k in req.body);
  await saveSettings(req.body, req.user.email ?? req.user.id);
  await audit(req, 'settings.update', undefined, { changed });
  res.json(view());
});
