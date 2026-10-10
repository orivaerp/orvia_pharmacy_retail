import { ApiError } from '../../utils/ApiError.js';
import { parseCsv } from '../../utils/csv.js';
import { Medicine, dedupeKey } from './medicine.model.js';
import { detectProfile } from './import-profiles.js';
import { saltKeyOf } from './salt-key.js';
import { medicineSchema } from './medicine.schema.js';

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Search filter shared by the provider list and the shops' catalog search (name, brand, salt, maker, barcode). */
export function searchFilter({ q, form, status, schedule }) {
  const filter = {};
  if (status) filter.status = status;
  if (form) filter.form = form;
  if (schedule) filter.schedule = schedule;
  const text = q?.trim();
  if (text) {
    // every word must match somewhere (name, brand, salt, maker), in any order; or the whole text is a barcode
    const words = text.split(/\s+/).filter(Boolean).slice(0, 8);
    const perWord = words.map((w) => {
      const rx = new RegExp(escapeRx(w), 'i');
      return { $or: [{ name: rx }, { brand: rx }, { composition: rx }, { manufacturer: rx }] };
    });
    filter.$or = [{ $and: perWord }, { barcodes: text }];
  }
  return filter;
}

export async function listMedicines(query, { page = 1, limit = 20 } = {}) {
  const filter = searchFilter(query);
  const [items, total] = await Promise.all([
    Medicine.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit),
    Medicine.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

async function assertNoBarcodeClash(barcodes, exceptId) {
  if (!barcodes?.length) return;
  const clash = await Medicine.findOne({ barcodes: { $in: barcodes }, ...(exceptId && { _id: { $ne: exceptId } }) }).select('name barcodes');
  if (clash) throw ApiError.conflict(`A barcode is already used by "${clash.name}"`);
}

export async function createMedicine(data, source = 'manual') {
  const key = dedupeKey(data);
  const existing = await Medicine.findOne({ dedupeKey: key }).select('name');
  if (existing) throw ApiError.conflict(`This medicine already exists in the catalog ("${existing.name}")`);
  await assertNoBarcodeClash(data.barcodes);
  return Medicine.create({ ...data, dedupeKey: key, saltKey: saltKeyOf(data), source });
}

export async function updateMedicine(id, patch) {
  const med = await Medicine.findById(id);
  if (!med) throw ApiError.notFound('Medicine not found');
  Object.assign(med, patch);
  const key = dedupeKey(med);
  if (key !== med.dedupeKey) {
    if (await Medicine.exists({ dedupeKey: key, _id: { $ne: med._id } })) throw ApiError.conflict('Another medicine with the same name, strength, form and manufacturer already exists');
    med.dedupeKey = key;
  }
  await assertNoBarcodeClash(med.barcodes, med._id);
  med.saltKey = saltKeyOf(med);
  med.version += 1;
  return med.save();
}

/**
 * Bulk import from CSV text. With dryRun it only reports what WOULD happen.
 * Rows that are invalid or already in the catalog are skipped and listed; the rest are inserted.
 */
export async function importMedicines(csv, { dryRun, source = 'import', defaults = {} }) {
  const parsedRows = parseCsv(csv);
  if (!parsedRows.length) throw ApiError.badRequest('The file has no data rows');
  if (parsedRows.length > 5000) throw ApiError.badRequest('Please import at most 5000 rows at a time');

  // A supplier-style list (e.g. "Generic Name, Unit Size, MRP, Group Name") is converted by a profile first.
  const profile = detectProfile(Object.keys(parsedRows[0]));
  const profileDefaults = profile ? { ...profile.defaults, ...Object.fromEntries(Object.entries(defaults).filter(([, v]) => v !== undefined && v !== '')) } : null;
  const rows = profile ? parsedRows.map((r) => profile.map(r, profileDefaults)) : parsedRows;

  const errors = [];
  const duplicates = [];
  const candidates = [];
  const seenKeys = new Set();
  const seenBarcodes = new Map();

  rows.forEach((raw, i) => {
    const row = i + 2; // spreadsheet row number (row 1 is the header)
    const parsed = medicineSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ row, name: raw.name, message: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
      return;
    }
    const data = parsed.data;
    const key = dedupeKey(data);
    if (seenKeys.has(key)) return duplicates.push({ row, name: data.name, reason: 'Repeated in this file' });
    const clash = data.barcodes.find((b) => seenBarcodes.has(b));
    if (clash) return errors.push({ row, name: data.name, message: `barcode ${clash} is also used on row ${seenBarcodes.get(clash)}` });
    seenKeys.add(key);
    data.barcodes.forEach((b) => seenBarcodes.set(b, row));
    candidates.push({ row, data: { ...data, dedupeKey: key } });
  });

  const existing = await Medicine.find({ dedupeKey: { $in: candidates.map((c) => c.data.dedupeKey) } }).select('dedupeKey').lean();
  const existingKeys = new Set(existing.map((e) => e.dedupeKey));
  let fresh = candidates.filter((c) => {
    if (!existingKeys.has(c.data.dedupeKey)) return true;
    duplicates.push({ row: c.row, name: c.data.name, reason: 'Already in the catalog' });
    return false;
  });

  const allBarcodes = fresh.flatMap((c) => c.data.barcodes);
  if (allBarcodes.length) {
    const used = await Medicine.find({ barcodes: { $in: allBarcodes } }).select('name barcodes').lean();
    const usedMap = new Map(used.flatMap((u) => u.barcodes.map((b) => [b, u.name])));
    fresh = fresh.filter((c) => {
      const b = c.data.barcodes.find((x) => usedMap.has(x));
      if (!b) return true;
      errors.push({ row: c.row, name: c.data.name, message: `barcode ${b} already belongs to "${usedMap.get(b)}"` });
      return false;
    });
  }

  let created = 0;
  if (!dryRun && fresh.length) {
    try {
      const res = await Medicine.insertMany(fresh.map((c) => ({ ...c.data, saltKey: saltKeyOf(c.data), source })), { ordered: false });
      created = res.length;
    } catch (err) {
      // a concurrent import may have inserted some rows first; count what actually went in
      created = err.insertedDocs?.length ?? err.result?.insertedCount ?? 0;
      if (!created && !err.writeErrors) throw err;
    }
  }

  return {
    dryRun: !!dryRun,
    profile: profile ? { id: profile.id, label: profile.label, defaults: profileDefaults, importedAs: 'pending' } : null,
    totalRows: rows.length,
    toCreate: fresh.length,
    created,
    duplicates: duplicates.sort((a, b) => a.row - b.row),
    errors: errors.sort((a, b) => a.row - b.row),
  };
}

/** Sets the status of many medicines at once: by ids, or everything that matches the current filter. */
export async function bulkSetStatus({ status, ids, filter }) {
  const where = ids?.length ? { _id: { $in: ids } } : searchFilter(filter ?? {});
  const res = await Medicine.updateMany(where, { $set: { status }, $inc: { version: 1 } });
  return { matched: res.matchedCount, updated: res.modifiedCount };
}

/** Other medicines with the same salts, strength and form. Shops see verified ones only. */
export async function substitutesOf(id, { verifiedOnly = true } = {}) {
  const med = await Medicine.findById(id).select('saltKey name').lean();
  if (!med) throw ApiError.notFound('Medicine not found');
  if (!med.saltKey) return [];
  const filter = { saltKey: med.saltKey, _id: { $ne: med._id } };
  if (verifiedOnly) filter.status = 'verified';
  return Medicine.find(filter).sort({ brand: -1, name: 1 }).limit(30).lean();
}
