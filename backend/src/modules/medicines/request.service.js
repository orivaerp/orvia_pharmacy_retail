import { ApiError } from '../../utils/ApiError.js';
import { Product } from '../products/product.model.js';
import { Medicine } from './medicine.model.js';
import { createMedicine } from './medicine.service.js';
import { MedicineRequest } from './request.model.js';

export async function listRequests({ status = 'pending', page = 1, limit = 20 }) {
  const filter = status === 'all' ? {} : { status };
  const [items, total] = await Promise.all([
    MedicineRequest.find(filter)
      .populate('tenantId', 'name code')
      .populate('requestedBy', 'name email')
      .populate('medicineId', 'name strength manufacturer')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    MedicineRequest.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

async function getPending(id) {
  const req = await MedicineRequest.findById(id);
  if (!req) throw ApiError.notFound('Request not found');
  if (req.status !== 'pending') throw ApiError.conflict(`This request was already ${req.status}`);
  return req;
}

/** Points the shop's private product at the catalog entry, so it now follows the master. */
async function linkProduct(req, medicineId) {
  if (!req.productId) return;
  try {
    await Product.updateOne({ _id: req.productId, tenantId: req.tenantId }, { masterId: medicineId, isCustom: false }).setOptions({ skipTenant: true });
  } catch (err) {
    if (err.code !== 11000) throw err; // shop already added this medicine from the catalog: keep its private copy
  }
}

async function close(req, status, reviewerId, extra = {}) {
  Object.assign(req, { status, reviewedBy: reviewerId, reviewedAt: new Date() }, extra);
  return req.save();
}

/** Creates the catalog entry from the (provider-edited) details and links the shop's product to it. */
export async function approveRequest(id, medicineData, reviewerId) {
  const req = await getPending(id);
  const medicine = await createMedicine(medicineData, 'request');
  await linkProduct(req, medicine._id);
  await close(req, 'approved', reviewerId, { medicineId: medicine._id });
  return { request: req, medicine };
}

/** The medicine already exists in the catalog under another spelling: link to it instead of creating. */
export async function mergeRequest(id, medicineId, reviewerId) {
  const req = await getPending(id);
  const medicine = await Medicine.findById(medicineId);
  if (!medicine) throw ApiError.notFound('Catalog medicine not found');
  await linkProduct(req, medicine._id);
  await close(req, 'merged', reviewerId, { medicineId: medicine._id });
  return { request: req, medicine };
}

export async function rejectRequest(id, note, reviewerId) {
  const req = await getPending(id);
  await close(req, 'rejected', reviewerId, { reviewNote: note });
  return { request: req };
}
