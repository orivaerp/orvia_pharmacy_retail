import { z } from 'zod';
import { ApiError } from '../../utils/ApiError.js';
import { Customer, normalizePhone } from '../customers/customer.model.js';
import { Supplier } from '../purchases/purchase.model.js';
import { cell, key, parseNumber } from './parse.js';
import { MAX_ROWS } from './stock-import.service.js';

const emailOk = (v) => z.email().safeParse(v).success;

/** Reads a number cell that may be blank. Returns { value } or { error }. */
function money(raw, label, { min = 0, max = 10_000_000 } = {}) {
  if (cell(raw) === undefined) return { value: 0 };
  const n = parseNumber(raw);
  if (!Number.isFinite(n) || n < min || n > max) return { error: `${label} must be a number${min >= 0 ? ' (0 or more)' : ''}` };
  return { value: Math.round(n * 100) / 100 };
}

/** One row of the customers sheet, cleaned, with the problems found. */
function readCustomer(raw) {
  const errors = [];
  const name = cell(raw.name);
  if (!name || name.length < 2) errors.push('Name is missing');
  const out = { name, address: cell(raw.address), notes: cell(raw.notes) };
  if (cell(raw.phone) !== undefined) {
    const p = normalizePhone(raw.phone);
    if (p) out.phone = p;
    else errors.push('Phone must have 10 digits');
  }
  const email = cell(raw.email)?.toLowerCase();
  if (email) {
    if (emailOk(email)) out.email = email;
    else errors.push(`Email "${raw.email}" is not valid`);
  }
  const limit = money(raw.creditLimit, 'Udhaar limit');
  if (limit.error) errors.push(limit.error);
  else out.creditLimit = limit.value;
  const open = money(raw.openingBalance, 'Already owes');
  if (open.error) errors.push(open.error);
  else out.openingBalance = open.value;
  return { out, errors };
}

function readSupplier(raw) {
  const errors = [];
  const name = cell(raw.name);
  if (!name || name.length < 2) errors.push('Name is missing');
  const out = { name, contactPerson: cell(raw.contactPerson), phone: cell(raw.phone), address: cell(raw.address), city: cell(raw.city), state: cell(raw.state), drugLicenseNo: cell(raw.drugLicenseNo), notes: cell(raw.notes) };
  const email = cell(raw.email)?.toLowerCase();
  if (email) {
    if (emailOk(email)) out.email = email;
    else errors.push(`Email "${raw.email}" is not valid`);
  }
  const gstin = cell(raw.gstin)?.toUpperCase().replace(/\s+/g, '');
  if (gstin) {
    if (/^[0-9A-Z]{15}$/.test(gstin)) out.gstin = gstin;
    else errors.push('GSTIN must be 15 letters and digits');
  }
  if (cell(raw.creditDays) !== undefined) {
    const d = parseNumber(raw.creditDays);
    if (Number.isInteger(d) && d >= 0 && d <= 365) out.creditDays = d;
    else errors.push('Credit days must be a whole number from 0 to 365');
  } else out.creditDays = 0;
  const open = money(raw.openingBalance, 'We owe them', { min: -10_000_000 });
  if (open.error) errors.push(open.error);
  else out.openingBalance = open.value;
  return { out, errors };
}

const KINDS = {
  customers: {
    read: readCustomer,
    model: Customer,
    // an existing customer is found by phone; without a phone, by an identical name that also has no phone
    async existing() {
      const all = await Customer.find({}).select('name phone').lean();
      const byPhone = new Map(all.filter((c) => c.phone).map((c) => [c.phone, c]));
      const byName = new Map(all.filter((c) => !c.phone).map((c) => [key(c.name), c]));
      return (o) => (o.phone ? byPhone.get(o.phone) : byName.get(key(o.name)));
    },
    seen: (o) => [o.phone ? `p:${o.phone}` : `n:${key(o.name)}`],
    dupeNote: (o) => (o.phone ? 'phone number' : 'name'),
    owes: (o) => o.openingBalance,
  },
  suppliers: {
    read: readSupplier,
    model: Supplier,
    async existing() {
      const all = await Supplier.find({}).select('name gstin').lean();
      const byName = new Map(all.map((s) => [key(s.name), s]));
      const byGst = new Map(all.filter((s) => s.gstin).map((s) => [s.gstin, s]));
      return (o) => byName.get(key(o.name)) ?? (o.gstin ? byGst.get(o.gstin) : undefined);
    },
    seen: (o) => [`n:${key(o.name)}`, ...(o.gstin ? [`g:${o.gstin}`] : [])],
    dupeNote: () => 'name',
    owes: (o) => o.openingBalance,
  },
};

/** Which rows of a customers / suppliers sheet are new, already there, or wrong. Reads only. */
export async function analysePeople(kind, { rows }) {
  const k = KINDS[kind];
  if (!k) throw ApiError.notFound('Unknown import');
  if (!Array.isArray(rows) || !rows.length) throw ApiError.badRequest('The file has no rows');
  if (rows.length > MAX_ROWS) throw ApiError.badRequest(`Import up to ${MAX_ROWS} rows at a time. Split the file and import it in parts.`);
  const find = await k.existing();
  const seen = new Map();
  const out = rows.map((raw, i) => {
    const { out: o, errors } = k.read(raw);
    const row = { row: i + 2, name: o.name ?? '', errors, warnings: [], action: null, o };
    if (errors.length) return row;
    if (find(o)) {
      row.action = 'exists';
      row.warnings.push(`Already in your ${kind} (same ${k.dupeNote(o)}); skipped, nothing is changed`);
      return row;
    }
    const keys = k.seen(o);
    const same = keys.find((x) => seen.has(x));
    if (same) {
      row.action = 'exists';
      row.warnings.push(`Same ${same.startsWith('g:') ? 'GSTIN' : k.dupeNote(o)} as row ${seen.get(same)}; skipped`);
      return row;
    }
    for (const x of keys) seen.set(x, row.row);
    row.action = 'new';
    if (kind === 'customers' && !o.phone) row.warnings.push('No phone number: it cannot be found by phone at the counter');
    return row;
  });
  const fresh = out.filter((r) => r.action === 'new');
  return {
    rows: out,
    fresh,
    summary: {
      rows: out.length,
      new: fresh.length,
      existing: out.filter((r) => r.action === 'exists').length,
      errors: out.filter((r) => r.errors.length).length,
      openingTotal: Math.round(fresh.reduce((s, r) => s + (k.owes(r.o) || 0), 0) * 100) / 100,
    },
  };
}

export const previewPeople = (a) => ({ summary: a.summary, rows: a.rows.map((r) => ({ row: r.row, name: r.name, action: r.action, errors: r.errors, warnings: r.warnings })) });

export async function commitPeople(kind, user, input) {
  const a = await analysePeople(kind, input);
  if (!a.fresh.length) throw ApiError.badRequest('There is nothing new to import');
  const k = KINDS[kind];
  const docs = a.fresh.map((r) => ({ ...Object.fromEntries(Object.entries(r.o).filter(([, v]) => v !== undefined)), ...(kind === 'customers' && { createdBy: user.id }) }));
  let created = 0;
  try {
    created = (await k.model.insertMany(docs, { ordered: false })).length;
  } catch (e) {
    // a row that raced with another save (e.g. the same phone) is skipped; the rest are kept
    if (e.insertedDocs) created = e.insertedDocs.length;
    else throw e;
  }
  return {
    created,
    skippedExisting: a.summary.existing,
    skipped: a.rows.filter((r) => r.errors.length).map((r) => ({ row: r.row, name: r.name, reason: r.errors[0] })),
    openingTotal: a.summary.openingTotal,
  };
}
