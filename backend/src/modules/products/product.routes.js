import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { requirePermission, requireTenant } from '../../middleware/auth.js';
import { assertWithinLimit } from '../plans/plan.service.js';
import { validateBody } from '../../middleware/validate.js';
import { randomInt } from 'node:crypto';
import { audit } from '../audit/audit.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { Medicine } from '../medicines/medicine.model.js';
import { medicineSchema } from '../medicines/medicine.schema.js';
import { searchFilter, substitutesOf } from '../medicines/medicine.service.js';
import { MedicineRequest } from '../medicines/request.model.js';
import { Product, toView } from './product.model.js';

const router = Router();
router.use(requireTenant);

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const paging = (q) => ({ page: Math.max(1, Number(q.page) || 1), limit: Math.min(50, Math.max(1, Number(q.limit) || 20)) });
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Custom product = the master fields a shop can know, with safe defaults for the rest.
const customSchema = medicineSchema
  .omit({ status: true, category: true, barcodes: true, externalCode: true })
  .extend({
    hsn: z.string().trim().regex(/^\d{4,8}$/, 'HSN must be 4-8 digits').default('3004'),
    manufacturer: z.string().trim().max(120).default('Unknown'),
    barcode: z.string().trim().max(40).optional().or(z.literal('').transform(() => undefined)),
    suggest: z.boolean().default(false), // also ask the provider to add it to the master catalog
  });

const settingsSchema = z.object({
  reorderLevel: z.number().int().min(0).optional(),
  maxLevel: z.number().int().min(0).optional(),
  location: z.string().trim().max(60).optional(),
  looseSelling: z.boolean().optional(),
  refillDays: z.number().int().min(0).max(365).optional(),
  isActive: z.boolean().optional(),
});

// ---- search the master catalog (verified medicines only) ------------------
router.get('/catalog', requirePermission(P.INVENTORY_VIEW), async (req, res) => {
  const { page, limit } = paging(req.query);
  const filter = { ...searchFilter({ q: req.query.q?.toString(), form: req.query.form?.toString() }), status: 'verified' };
  const [items, total] = await Promise.all([
    Medicine.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Medicine.countDocuments(filter),
  ]);
  const added = new Set((await Product.find({ masterId: { $in: items.map((m) => m._id) } }).select('masterId').lean()).map((p) => String(p.masterId)));
  res.json({ items: items.map((m) => ({ ...m, added: added.has(String(m._id)) })), total, page, limit });
});

// same salts, strength and form (brands and generics), so a shop can offer or choose an alternative
router.get('/catalog/:id/substitutes', requirePermission(P.INVENTORY_VIEW), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Medicine not found');
  const items = await substitutesOf(req.params.id, { verifiedOnly: true });
  const added = new Set((await Product.find({ masterId: { $in: items.map((m) => m._id) } }).select('masterId').lean()).map((p) => String(p.masterId)));
  res.json(items.map((m) => ({ ...m, added: added.has(String(m._id)) })));
});

// ---- this shop's inventory items -------------------------------------------
router.get('/', requirePermission(P.INVENTORY_VIEW), async (req, res) => {
  const { page, limit } = paging(req.query);
  const q = req.query.q?.toString().trim();
  const filter = {};
  if (q) {
    const rx = new RegExp(escapeRx(q), 'i');
    const masterIds = (await Medicine.find(searchFilter({ q })).limit(500).select('_id').lean()).map((m) => m._id);
    // own fields cover custom products; barcodes the shop scanned and saved cover catalog ones too
    filter.$or = [{ masterId: { $in: masterIds } }, { name: rx }, { brand: rx }, { composition: rx }, { barcodes: q }];
  }
  const [items, total] = await Promise.all([
    Product.find(filter).populate('masterId').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ items: items.map(toView), total, page, limit });
});

// "Add to my inventory": tick several catalog medicines, add them in one go
router.post('/from-master', requirePermission(P.PRODUCT_MANAGE), validateBody(z.object({ medicineIds: z.array(objectId).min(1).max(200) })), async (req, res) => {
  const ids = [...new Set(req.body.medicineIds)];
  const [medicines, have] = await Promise.all([
    Medicine.find({ _id: { $in: ids }, status: 'verified' }).select('_id').lean(),
    Product.find({ masterId: { $in: ids } }).select('masterId').lean(),
  ]);
  const haveSet = new Set(have.map((p) => String(p.masterId)));
  const toAdd = medicines.filter((m) => !haveSet.has(String(m._id)));
  if (toAdd.length) await assertWithinLimit(req.user.tenantId, 'products', toAdd.length);
  if (toAdd.length) await Product.insertMany(toAdd.map((m) => ({ masterId: m._id })), { ordered: false });
  if (toAdd.length) await audit(req, 'product.add', req.user.tenantId, { added: toAdd.length });
  res.status(201).json({ added: toAdd.length, alreadyHad: haveSet.size, unavailable: ids.length - medicines.length });
});

/** A verified catalog medicine that already is what the shop is about to create privately (same barcode, or same name/strength/form). */
async function catalogTwin(data) {
  if (data.barcode) {
    const byBarcode = await Medicine.findOne({ barcodes: data.barcode, status: 'verified' }).select('name manufacturer').lean();
    if (byBarcode) return byBarcode;
  }
  const rx = new RegExp(`^${escapeRx(data.name)}$`, 'i');
  return Medicine.findOne({ name: rx, strength: data.strength, form: data.form, status: 'verified' }).select('name manufacturer').lean();
}

// Not in the catalog? Make a private product right away; optionally suggest it to the provider.
router.post('/custom', requirePermission(P.PRODUCT_MANAGE), validateBody(customSchema), async (req, res) => {
  const { suggest, barcode, ...data } = req.body;
  await assertWithinLimit(req.user.tenantId, 'products');

  const twin = await catalogTwin({ ...data, barcode });
  if (twin) throw ApiError.conflict(`"${twin.name}" (${twin.manufacturer}) is already in the Orvia catalog. Search for it and add it from there instead of creating a copy.`);

  const dupe = await Product.findOne({ name: new RegExp(`^${escapeRx(data.name)}$`, 'i'), strength: data.strength, form: data.form });
  if (dupe) throw ApiError.conflict('You already have a product with this name, strength and form');
  if (barcode && (await Product.exists({ barcodes: barcode }))) throw ApiError.conflict('This barcode is already saved on another product in your shop');

  const product = await Product.create({ ...data, barcodes: barcode ? [barcode] : [], isCustom: true });
  if (suggest) {
    await MedicineRequest.create({
      tenantId: req.user.tenantId,
      requestedBy: req.user.id,
      productId: product._id,
      name: data.name,
      brand: data.brand,
      barcode,
      referenceMrp: data.referenceMrp,
      composition: data.composition.join('; '),
      strength: data.strength,
      form: data.form,
      manufacturer: data.manufacturer,
      gstPercent: data.gstPercent,
      schedule: data.schedule,
    });
  }
  await audit(req, 'product.custom', req.user.tenantId, { name: data.name, suggested: suggest });
  res.status(201).json({ ...toView(product), suggested: suggest });
});

/** Scan once, remembered: saves a barcode on the shop's product so the next scan finds it directly. */
router.post('/:id/barcode', requirePermission(P.PRODUCT_MANAGE), validateBody(z.object({ barcode: z.string().trim().min(6).max(40) })), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Product not found');
  const { barcode } = req.body;
  const product = await Product.findById(req.params.id).populate('masterId');
  if (!product) throw ApiError.notFound('Product not found');

  const other = await Product.findOne({ barcodes: barcode, _id: { $ne: product._id } });
  if (other) throw ApiError.conflict('This barcode is already saved on another product in your shop');
  const owner = await Medicine.findOne({ barcodes: barcode }).select('_id name').lean();
  if (owner && String(owner._id) !== String(product.masterId?._id ?? '')) throw ApiError.conflict(`This barcode belongs to "${owner.name}" in the catalog`);

  if (!product.barcodes.includes(barcode)) {
    product.barcodes.push(barcode);
    await product.save();
    await audit(req, 'product.barcode_add', req.user.tenantId, { productId: String(product._id), barcode });
  }
  res.json(toView(product));
});

/**
 * Makes the shop's own barcode for a product that has none (loose strips, small makers).
 * It is an EAN-13 starting with 2, the range reserved for in-store use, so it can never clash with a maker's code.
 */
const ean13Check = (d12) => (10 - (([...d12].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0)) % 10)) % 10;
router.post('/:id/barcode/generate', requirePermission(P.PRODUCT_MANAGE), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Product not found');
  const product = await Product.findById(req.params.id).populate('masterId');
  if (!product) throw ApiError.notFound('Product not found');
  if (toView(product).barcodes.length) throw ApiError.conflict('This product already has a barcode. Print labels with it, or remove it first.');
  for (let attempt = 0; attempt < 10; attempt++) {
    const first12 = '2' + String(randomInt(0, 1e11)).padStart(11, '0');
    const code = first12 + ean13Check(first12);
    if ((await Product.exists({ barcodes: code })) || (await Medicine.exists({ barcodes: code }))) continue;
    product.barcodes.push(code);
    await product.save();
    await audit(req, 'product.barcode_generate', req.user.tenantId, { productId: String(product._id), barcode: code });
    return res.json(toView(product));
  }
  throw new ApiError(500, 'Could not make a free barcode. Try again.');
});

/** Takes a barcode this shop saved off a product (a wrong link). The catalog's own barcodes cannot be removed here. */
router.delete('/:id/barcode', requirePermission(P.PRODUCT_MANAGE), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Product not found');
  const barcode = req.query.barcode?.toString().trim();
  if (!barcode) throw ApiError.badRequest('Say which barcode to remove');
  const product = await Product.findById(req.params.id).populate('masterId');
  if (!product) throw ApiError.notFound('Product not found');
  if (!product.barcodes.includes(barcode)) throw ApiError.notFound('This barcode was not saved by your shop on this product');
  product.barcodes = product.barcodes.filter((b) => b !== barcode);
  await product.save();
  await audit(req, 'product.barcode_remove', req.user.tenantId, { productId: String(product._id), barcode });
  res.json(toView(product));
});

router.patch('/:id', requirePermission(P.PRODUCT_MANAGE), validateBody(settingsSchema), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Product not found');
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).populate('masterId');
  if (!product) throw ApiError.notFound('Product not found');
  await audit(req, 'product.update', req.user.tenantId, { name: toView(product).name, changes: Object.keys(req.body) });
  res.json(toView(product));
});

export default router;

