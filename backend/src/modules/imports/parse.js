import { FORMS, SCHEDULES } from '../medicines/medicine.model.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
export const key = norm;

/** Cleans a cell: trims text, turns "" into undefined. */
export const cell = (v) => {
  if (v === null || v === undefined) return undefined;
  const t = String(v).trim();
  return t === '' ? undefined : t;
};

/** Accepts what shops really type for expiry and returns "YYYY-MM" (or null). 08/2027, 8/27, Aug-27, Aug 2027, 2027-08, 2027-08-31, 31/08/2027, 2027-08-31T00:00:00Z */
export function parseExpiry(v) {
  const t = cell(v);
  if (!t) return null;
  const fix = (y, m) => {
    y = Number(y);
    m = Number(m);
    if (y < 100) y += 2000;
    return m >= 1 && m <= 12 && y >= 2000 && y <= 2100 ? `${y}-${String(m).padStart(2, '0')}` : null;
  };
  let m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[T ].*)?$/))) return fix(m[1], m[2]); // 2027-08, 2027-08-31, ISO
  if ((m = t.match(/^\d{1,2}[/.-](\d{1,2})[/.-](\d{4})$/))) return fix(m[2], m[1]); // 31/08/2027
  if ((m = t.match(/^(\d{1,2})[/.-](\d{2}|\d{4})$/))) return fix(m[2], m[1]); // 08/2027, 8/27
  if ((m = t.match(/^([a-z]{3})[a-z]*[\s./-]+(\d{2}|\d{4})$/i)) && MONTHS.includes(m[1].toLowerCase())) return fix(m[2], MONTHS.indexOf(m[1].toLowerCase()) + 1); // Aug-27, August 2027
  return null;
}

/** "1,250.50", "₹ 42", "42/-" -> number, or NaN. */
export function parseNumber(v) {
  const t = cell(v);
  if (t === undefined) return NaN;
  return Number(t.replace(/[₹,\s]|rs\.?|\/-$/gi, ''));
}

export const GST_RATES = [0, 5, 12, 18, 28];

/** Reads one raw row (canonical keys) into clean values plus the problems found. Nothing here touches the database. */
export function readRow(raw) {
  const errors = [];
  const name = cell(raw.name);
  if (!name || name.length < 2) errors.push('Medicine name is missing');
  const out = { name, manufacturer: cell(raw.manufacturer), strength: cell(raw.strength), barcode: cell(raw.barcode)?.replace(/\s+/g, ''), composition: cell(raw.composition), rack: cell(raw.rack), hsn: cell(raw.hsn) };

  const form = cell(raw.form)?.toLowerCase();
  if (form) {
    if (FORMS.includes(form)) out.form = form;
    else errors.push(`Form "${raw.form}" is not one of: ${FORMS.join(', ')}`);
  }
  const sch = cell(raw.schedule)?.toUpperCase();
  if (sch) {
    if (SCHEDULES.includes(sch)) out.schedule = sch;
    else errors.push(`Schedule "${raw.schedule}" must be one of: ${SCHEDULES.join(', ')}`);
  }
  if (cell(raw.gst) !== undefined) {
    const g = parseNumber(String(cell(raw.gst)).replace('%', ''));
    if (GST_RATES.includes(g)) out.gst = g;
    else errors.push('GST % must be 0, 5, 12, 18 or 28');
  }
  if (cell(raw.hsn) && !/^\d{4,8}$/.test(out.hsn)) errors.push('HSN must be 4-8 digits');
  if (cell(raw.packSize) !== undefined) {
    const n = parseNumber(raw.packSize);
    if (Number.isInteger(n) && n >= 1 && n <= 10000) out.unitsPerPack = n;
    else errors.push('Pack size must be a whole number (units in one pack, e.g. 10 tablets)');
  }

  // stock: needs batch, expiry, MRP and a quantity; quantity blank or 0 means "just add the product"
  const qtyCell = cell(raw.packs);
  const qty = qtyCell === undefined ? 0 : parseNumber(qtyCell);
  if (Number.isNaN(qty) || qty < 0 || !Number.isInteger(qty)) errors.push('Quantity must be a whole number of packs');
  else if (qty > 100000) errors.push('Quantity is too large');
  else out.packs = qty;

  if (out.packs > 0) {
    const batch = cell(raw.batchNo);
    if (!batch) errors.push('Batch number is missing');
    else if (batch.length > 30) errors.push('Batch number is too long');
    else out.batchNo = batch.toUpperCase();
    const expiry = parseExpiry(raw.expiry);
    if (!expiry) errors.push(cell(raw.expiry) ? `Expiry "${raw.expiry}" is not a month and year (like 08/2027)` : 'Expiry is missing');
    else out.expiry = expiry;
    const mrp = parseNumber(raw.mrp);
    if (!(mrp > 0) || mrp > 10_000_000) errors.push('MRP must be more than 0');
    else out.mrp = Math.round(mrp * 100) / 100;
    if (cell(raw.purchaseRate) !== undefined) {
      const pr = parseNumber(raw.purchaseRate);
      if (!(pr >= 0) || pr > 10_000_000) errors.push('Purchase rate must be 0 or more');
      else out.purchaseRate = Math.round(pr * 100) / 100;
    } else out.purchaseRate = 0;
  }
  return { out, errors };
}
