import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { STATE_CODES, isValidGstin, stateCodeOfGstin, stateCodeOfName } from '../../utils/gst.js';
import { Branch } from '../branches/branch.model.js';
import { Purchase, PurchaseReturn, Supplier } from '../purchases/purchase.model.js';
import { Tenant } from '../tenants/tenant.model.js';
import { dayRange } from './report.service.js';
import { Sale, SaleReturn } from './sale.model.js';

/**
 * GST filing figures: GSTR-1 (what was sold), GSTR-3B (the summary and the input tax credit) and e-invoice files.
 * They are worked out from the bills, returns and purchase invoices, and written in the layouts the GST portal and the
 * e-invoice portal (IRP) take. They are NOT sent anywhere: the owner or their accountant checks the figures and uploads the file.
 *
 * Rules used here (kept simple on purpose):
 *  - a month is the filing period;
 *  - a bill cancelled in the same month it was made is left out completely (as if never issued) and counts as cancelled in "documents issued";
 *    a bill cancelled in a later month stays in its own month and its refund becomes a credit note in the month of the cancellation;
 *  - a return is a credit note in the month it was made. To a customer with a GSTIN it is listed (CDNR); to anyone else it is taken off the B2C totals;
 *  - tax at 0% is shown as nil rated.
 */

const TZ = 'Asia/Kolkata';
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const oid = (id) => new mongoose.Types.ObjectId(id);
const ym = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date(d)).slice(0, 7);
const ddmmyyyy = (d, sep = '/') => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)).replaceAll('/', sep);

export function monthRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')) throw ApiError.badRequest('Choose a month, like 2026-10');
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { ...dayRange(`${month}-01`, `${month}-${String(last).padStart(2, '0')}`), fp: `${String(m).padStart(2, '0')}${y}` };
}

/** Splits a GST amount into IGST (other state) or CGST + SGST. */
function split(gst, interState) {
  if (interState) return { igst: r2(gst), cgst: 0, sgst: 0 };
  const cgst = r2(gst / 2);
  return { igst: 0, cgst, sgst: r2(gst - cgst) };
}

const scope = ({ branchId, branchIds }) => (branchId ? { branchId: oid(branchId) } : branchIds?.length ? { branchId: { $in: branchIds.map(oid) } } : {});

/** The shop's own GSTIN for the filing: the outlet's, else the shop's. One filing is for one GSTIN. */
async function filingIdentity(opts, branchGstins) {
  const tenant = await Tenant.findById(opts.tenantId ?? undefined).select('name gstin address').lean();
  const set = new Set(branchGstins.filter(Boolean));
  if (set.size > 1) throw ApiError.badRequest('Your outlets have different GSTINs. Choose one outlet, because each GSTIN files its own return.');
  const gstin = [...set][0] || tenant?.gstin || '';
  return { gstin, state: stateCodeOfGstin(gstin), legalName: tenant?.name ?? '', tenant };
}

/** Everything the three outward tables are made from, for one month. */
async function loadOutward(opts, range) {
  const where = { ...scope(opts) };
  const [salesIn, retsIn] = await Promise.all([
    Sale.find({ ...where, createdAt: { $gte: range.start, $lte: range.end } }).sort({ createdAt: 1 }).lean(),
    SaleReturn.find({ ...where, createdAt: { $gte: range.start, $lte: range.end } }).sort({ createdAt: 1 }).lean(),
  ]);
  const period = ym(range.start);
  const isVoid = (s) => s.status === 'CANCELLED' && s.cancelledAt && ym(s.cancelledAt) === ym(s.createdAt);
  const sales = salesIn.filter((s) => !isVoid(s));
  const cancelled = salesIn.filter((s) => s.status === 'CANCELLED' && ym(s.cancelledAt ?? s.createdAt) === period).length;

  // the bills the returns belong to (they can be from an earlier month)
  const have = new Map(salesIn.map((s) => [String(s._id), s]));
  const missing = [...new Set(retsIn.map((r) => String(r.saleId)).filter((id) => !have.has(id)))];
  if (missing.length) for (const s of await Sale.find({ _id: { $in: missing } }).lean()) have.set(String(s._id), s);

  const returns = retsIn.filter((r) => {
    const s = have.get(String(r.saleId));
    return s && !isVoid(s) && r.lines.length > 0;
  });

  const branches = await Branch.find({ _id: { $in: [...new Set([...salesIn, ...retsIn].map((x) => String(x.branchId)))] } }).select('gstin state').lean();
  const branchOf = new Map(branches.map((b) => [String(b._id), b]));
  return { sales, returns, billOf: have, branchOf, cancelled, salesAll: salesIn, retsAll: retsIn };
}

/** Tax of one sale line (what was billed). */
const lineTax = (l, interState) => ({ rate: l.gstPercent ?? 0, taxable: l.taxable, ...split(l.gst, interState) });

/** Tax inside a refund: the refund includes GST, so the tax is taken out of it the same way as on a bill. */
function refundTax(refund, rate, interState) {
  const taxable = r2(refund / (1 + rate / 100));
  return { rate, taxable, ...split(r2(refund - taxable), interState) };
}

export async function gstr1(opts, month) {
  const range = monthRange(month);
  const data = await loadOutward(opts, range);
  const id = await filingIdentity(opts, [...data.branchOf.values()].map((b) => b.gstin));
  const warnings = [];
  if (!id.gstin) warnings.push('Your GSTIN is not set. Add it in Settings (or on the outlet) before you upload this file.');
  else if (!isValidGstin(id.gstin)) warnings.push(`The GSTIN ${id.gstin} does not look valid. Check it in Settings.`);

  const sellerState = id.state;
  const posOf = (s) => s.placeOfSupply || sellerState;
  const interOf = (s) => (s.interState ?? false);

  // ---- 4 / B2B: invoices to customers with a GSTIN ----
  const b2bInv = [];
  const b2cs = new Map(); // place of supply + rate
  const addB2cs = (pos, t, sign) => {
    const k = `${pos}|${t.rate}`;
    const cur = b2cs.get(k) ?? { pos, rate: t.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    cur.taxable += sign * t.taxable;
    cur.igst += sign * t.igst;
    cur.cgst += sign * t.cgst;
    cur.sgst += sign * t.sgst;
    b2cs.set(k, cur);
  };
  const hsn = new Map();
  const addHsn = (code, rate, name, qty, value, t, sign) => {
    const k = `${code || ''}|${rate}`;
    const cur = hsn.get(k) ?? { hsn: code || '', rate, description: name, uqc: 'NOS', qty: 0, value: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    cur.qty += sign * qty;
    cur.value += sign * value;
    cur.taxable += sign * t.taxable;
    cur.igst += sign * t.igst;
    cur.cgst += sign * t.cgst;
    cur.sgst += sign * t.sgst;
    hsn.set(k, cur);
  };

  for (const s of data.sales) {
    const inter = interOf(s);
    const rows = new Map();
    for (const l of s.lines) {
      const t = lineTax(l, inter);
      addHsn(l.hsn, t.rate, l.name, l.units, l.total, t, 1);
      if (s.supplyType === 'B2B' && s.buyerGstin) {
        const cur = rows.get(t.rate) ?? { rate: t.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
        cur.taxable += t.taxable;
        cur.igst += t.igst;
        cur.cgst += t.cgst;
        cur.sgst += t.sgst;
        rows.set(t.rate, cur);
      } else addB2cs(posOf(s), t, 1);
    }
    if (s.supplyType === 'B2B' && s.buyerGstin) {
      b2bInv.push({ ctin: s.buyerGstin, buyer: s.customerName, number: s.number, date: s.createdAt, value: s.totals.grand, pos: posOf(s), items: [...rows.values()].map((r) => ({ ...r, taxable: r2(r.taxable), igst: r2(r.igst), cgst: r2(r.cgst), sgst: r2(r.sgst) })) });
    }
  }

  // ---- 9B: credit notes ----
  const cdnr = [];
  for (const r of data.returns) {
    const s = data.billOf.get(String(r.saleId));
    const inter = interOf(s);
    const rows = new Map();
    let value = 0;
    for (const rl of r.lines) {
      const line = s.lines.find((l) => String(l.batchId) === String(rl.batchId));
      if (!line) continue;
      const t = refundTax(rl.refund, line.gstPercent ?? 0, inter);
      value += rl.refund;
      addHsn(line.hsn, t.rate, line.name, rl.units, rl.refund, t, -1);
      if (s.supplyType === 'B2B' && s.buyerGstin) {
        const cur = rows.get(t.rate) ?? { rate: t.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
        cur.taxable += t.taxable;
        cur.igst += t.igst;
        cur.cgst += t.cgst;
        cur.sgst += t.sgst;
        rows.set(t.rate, cur);
      } else addB2cs(posOf(s), t, -1);
    }
    if (s.supplyType === 'B2B' && s.buyerGstin) {
      cdnr.push({ ctin: s.buyerGstin, buyer: s.customerName, number: r.number, date: r.createdAt, invoice: s.number, invoiceDate: s.createdAt, value: r2(value), pos: posOf(s), items: [...rows.values()].map((x) => ({ ...x, taxable: r2(x.taxable), igst: r2(x.igst), cgst: r2(x.cgst), sgst: r2(x.sgst) })) });
    }
  }

  const fix = (o) => ({ ...o, taxable: r2(o.taxable), igst: r2(o.igst), cgst: r2(o.cgst), sgst: r2(o.sgst) });
  const taxed = (rows) => rows.filter((r) => r.rate > 0);
  const nilRows = (rows) => rows.filter((r) => r.rate === 0);
  const b2csAll = [...b2cs.values()].map(fix).sort((a, b) => a.rate - b.rate);
  const hsnAll = [...hsn.values()].map((h) => ({ ...fix(h), value: r2(h.value) })).filter((h) => h.qty !== 0 || h.taxable !== 0).sort((a, b) => (a.hsn + a.rate < b.hsn + b.rate ? -1 : 1));
  if (hsnAll.some((h) => !h.hsn)) warnings.push('Some medicines have no HSN code. The HSN table needs one for every item: add it on the product or in the medicine master.');
  else if (hsnAll.some((h) => h.hsn.length < 4)) warnings.push('Some HSN codes have fewer than 4 digits.');
  if (data.sales.some((s) => s.supplyType === 'B2B' && !s.buyerGstin)) warnings.push('A B2B bill has no customer GSTIN.');

  // ---- 13: documents issued ----
  const docs = [];
  const docRange = (name, list, cancelled) => {
    if (!list.length) return;
    const nums = list.map((x) => x.number).sort();
    docs.push({ name, from: nums[0], to: nums[nums.length - 1], total: list.length, cancelled, net: list.length - cancelled });
  };
  docRange('Invoices for outward supply', data.salesAll, data.cancelled);
  docRange('Credit note', data.retsAll, 0);

  const sum = (rows, k) => r2(rows.reduce((t, r) => t + r[k], 0));
  const totals = {
    taxable: r2(sum(b2bInv.flatMap((i) => i.items), 'taxable') + sum(b2csAll, 'taxable') - sum(cdnr.flatMap((c) => c.items), 'taxable')),
    igst: r2(sum(b2bInv.flatMap((i) => i.items), 'igst') + sum(b2csAll, 'igst') - sum(cdnr.flatMap((c) => c.items), 'igst')),
    cgst: r2(sum(b2bInv.flatMap((i) => i.items), 'cgst') + sum(b2csAll, 'cgst') - sum(cdnr.flatMap((c) => c.items), 'cgst')),
    sgst: r2(sum(b2bInv.flatMap((i) => i.items), 'sgst') + sum(b2csAll, 'sgst') - sum(cdnr.flatMap((c) => c.items), 'sgst')),
  };
  return {
    month,
    fp: range.fp,
    gstin: id.gstin,
    legalName: id.legalName,
    sellerState,
    warnings,
    counts: { bills: data.sales.length, cancelled: data.cancelled, creditNotes: data.returns.length, b2b: b2bInv.length },
    b2b: b2bInv,
    b2cs: taxed(b2csAll),
    nil: nilRows(b2csAll).concat(nilRows(b2bInv.flatMap((i) => i.items.map((x) => ({ ...x, pos: i.pos }))))),
    cdnr,
    hsn: hsnAll,
    docs,
    totals,
  };
}

// ------------------------------------------------------------------ portal JSON (GSTR-1 offline layout)

const item = (num, r) => ({ num, itm_det: { rt: r.rate, txval: r.taxable, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: 0 } });

export function gstr1PortalJson(f) {
  if (!f.gstin) throw ApiError.badRequest('Set your GSTIN in Settings first. The file needs it.');
  const group = (list) => {
    const by = new Map();
    for (const x of list) by.set(x.ctin, [...(by.get(x.ctin) ?? []), x]);
    return [...by.entries()];
  };
  return {
    gstin: f.gstin,
    fp: f.fp,
    version: 'GST3.0.4',
    hash: 'hash',
    b2b: group(f.b2b).map(([ctin, inv]) => ({
      ctin,
      inv: inv.map((i) => ({ inum: i.number, idt: ddmmyyyy(i.date, '-'), val: r2(i.value), pos: i.pos, rchrg: 'N', inv_typ: 'R', itms: i.items.map((r, n) => item(n + 1, r)) })),
    })),
    b2cs: f.b2cs.map((r) => ({ sply_ty: r.pos && r.pos !== f.sellerState ? 'INTER' : 'INTRA', rt: r.rate, typ: 'OE', pos: r.pos, txval: r.taxable, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: 0 })),
    cdnr: group(f.cdnr).map(([ctin, nt]) => ({
      ctin,
      nt: nt.map((c) => ({ ntty: 'C', nt_num: c.number, nt_dt: ddmmyyyy(c.date, '-'), val: c.value, pos: c.pos, rchrg: 'N', inv_typ: 'R', itms: c.items.map((r, n) => item(n + 1, r)) })),
    })),
    hsn: { data: f.hsn.map((h, n) => ({ num: n + 1, hsn_sc: h.hsn, desc: h.description.slice(0, 30), uqc: h.uqc, qty: h.qty, val: h.value, txval: h.taxable, iamt: h.igst, camt: h.cgst, samt: h.sgst, csamt: 0, rt: h.rate })) },
    doc_issue: {
      doc_det: f.docs.map((d, n) => ({ doc_num: d.name.startsWith('Credit') ? 5 : 1, doc_typ: d.name, docs: [{ num: n + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.net }] })),
    },
  };
}

// ------------------------------------------------------------------ CSV

const csvCell = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export const toCsv = (head, rows) => `﻿${[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
const stateName = (c) => (c ? `${c}-${STATE_CODES[c] ?? ''}` : '');

export function gstr1Csv(f, table) {
  const flat = (list, extra) => list.flatMap((d) => d.items.map((x) => extra(d, x)));
  switch (table) {
    case 'b2b':
      return toCsv(['GSTIN/UIN of recipient', 'Receiver name', 'Invoice number', 'Invoice date', 'Invoice value', 'Place of supply', 'Reverse charge', 'Invoice type', 'Rate', 'Taxable value', 'Integrated tax', 'Central tax', 'State/UT tax', 'Cess'],
        flat(f.b2b, (i, x) => [i.ctin, i.buyer, i.number, ddmmyyyy(i.date, '-'), i.value, stateName(i.pos), 'N', 'Regular', x.rate, x.taxable, x.igst, x.cgst, x.sgst, 0]));
    case 'b2cs':
      return toCsv(['Type', 'Place of supply', 'Rate', 'Taxable value', 'Integrated tax', 'Central tax', 'State/UT tax', 'Cess'], f.b2cs.map((r) => ['OE', stateName(r.pos), r.rate, r.taxable, r.igst, r.cgst, r.sgst, 0]));
    case 'cdnr':
      return toCsv(['GSTIN/UIN of recipient', 'Receiver name', 'Note number', 'Note date', 'Note type', 'Original invoice', 'Original invoice date', 'Place of supply', 'Note value', 'Rate', 'Taxable value', 'Integrated tax', 'Central tax', 'State/UT tax', 'Cess'],
        flat(f.cdnr, (c, x) => [c.ctin, c.buyer, c.number, ddmmyyyy(c.date, '-'), 'C', c.invoice, ddmmyyyy(c.invoiceDate, '-'), stateName(c.pos), c.value, x.rate, x.taxable, x.igst, x.cgst, x.sgst, 0]));
    case 'nil':
      return toCsv(['Description', 'Nil rated supplies'], [['Inter-state / intra-state supplies to registered and unregistered persons at 0%', f.nil.reduce((t, r) => t + r.taxable, 0)]]);
    case 'hsn':
      return toCsv(['HSN', 'Description', 'UQC', 'Total quantity', 'Total value', 'Rate', 'Taxable value', 'Integrated tax', 'Central tax', 'State/UT tax', 'Cess'], f.hsn.map((h) => [h.hsn, h.description, h.uqc, h.qty, h.value, h.rate, h.taxable, h.igst, h.cgst, h.sgst, 0]));
    case 'docs':
      return toCsv(['Nature of document', 'Sr. no. from', 'Sr. no. to', 'Total number', 'Cancelled', 'Net issued'], f.docs.map((d) => [d.name, d.from, d.to, d.total, d.cancelled, d.net]));
    default:
      throw ApiError.notFound('Table not found');
  }
}

// ------------------------------------------------------------------ GSTR-3B

export async function gstr3b(opts, month) {
  const range = monthRange(month);
  const f = await gstr1(opts, month);
  const warnings = [...f.warnings];

  // input tax credit: purchase invoices of the month from suppliers that have a GSTIN, less stock sent back
  const [bought, sentBack] = await Promise.all([
    Purchase.find({ ...scope(opts), invoiceDate: { $gte: range.start, $lte: range.end } }).select('supplierId lines.gst totals.gst').lean(),
    PurchaseReturn.find({ ...scope(opts), returnedOn: { $gte: range.start, $lte: range.end } }).select('supplierId lines.gst').lean(),
  ]);
  const suppliers = new Map((await Supplier.find({ _id: { $in: [...new Set([...bought, ...sentBack].map((p) => String(p.supplierId)))] } }).select('gstin').lean()).map((s) => [String(s._id), s.gstin]));
  const itc = { igst: 0, cgst: 0, sgst: 0 };
  let skipped = 0;
  const addItc = (supplierId, gst, sign) => {
    const g = suppliers.get(String(supplierId));
    if (!g || !isValidGstin(g)) {
      skipped += sign * gst;
      return;
    }
    const inter = Boolean(f.sellerState) && stateCodeOfGstin(g) !== f.sellerState;
    const t = split(gst, inter);
    itc.igst += sign * t.igst;
    itc.cgst += sign * t.cgst;
    itc.sgst += sign * t.sgst;
  };
  for (const p of bought) addItc(p.supplierId, p.lines.reduce((t, l) => t + (l.gst ?? 0), 0), 1);
  for (const p of sentBack) addItc(p.supplierId, p.lines.reduce((t, l) => t + (l.gst ?? 0), 0), -1);
  if (r2(skipped) > 0) warnings.push(`₹${r2(skipped)} of GST on purchases from suppliers without a valid GSTIN is not counted as input tax credit.`);
  if (!f.sellerState) warnings.push('The shop state could not be found (it comes from the GSTIN), so every purchase is treated as bought in your own state.');

  const outward = {
    taxable: r2(f.totals.taxable - f.nil.reduce((t, r) => t + r.taxable, 0)),
    igst: f.totals.igst,
    cgst: f.totals.cgst,
    sgst: f.totals.sgst,
  };
  const nilTaxable = r2(f.nil.reduce((t, r) => t + r.taxable, 0));
  const credit = { igst: r2(itc.igst), cgst: r2(itc.cgst), sgst: r2(itc.sgst) };
  return {
    month,
    fp: f.fp,
    gstin: f.gstin,
    legalName: f.legalName,
    warnings,
    outward,
    nilTaxable,
    itc: credit,
    // tax minus credit, head by head. The real set-off (IGST credit first, then CGST and SGST) is done on the portal.
    net: { igst: r2(outward.igst - credit.igst), cgst: r2(outward.cgst - credit.cgst), sgst: r2(outward.sgst - credit.sgst) },
  };
}

export function gstr3bPortalJson(f) {
  if (!f.gstin) throw ApiError.badRequest('Set your GSTIN in Settings first. The file needs it.');
  const heads = (o) => ({ iamt: o.igst, camt: o.cgst, samt: o.sgst, csamt: 0 });
  return {
    gstin: f.gstin,
    ret_period: f.fp,
    sup_details: {
      osup_det: { txval: f.outward.taxable, ...heads(f.outward) },
      osup_zero: { txval: 0, iamt: 0, csamt: 0 },
      osup_nil_exmp: { txval: f.nilTaxable },
      isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_nongst: { txval: 0 },
    },
    inter_sup: { unreg_details: [], comp_details: [], uin_details: [] },
    itc_elg: {
      itc_avl: [{ ty: 'OTH', ...heads(f.itc) }],
      itc_rev: [],
      itc_net: heads(f.itc),
      itc_inelg: [],
    },
    inward_sup: { isup_details: [{ ty: 'GST', inter: 0, intra: 0 }] },
    intr_ltfee: {},
  };
}

// ------------------------------------------------------------------ e-invoice (IRP schema 1.1)

const TEN_DIGITS = /^\d{4,8}$/;

async function parties(sale) {
  const [branch, tenant] = await Promise.all([Branch.findById(sale.branchId).lean(), Tenant.findById(sale.tenantId).select('name gstin address').lean()]);
  const problems = [];
  const gstin = sale.sellerGstin || branch?.gstin || tenant?.gstin;
  if (!gstin || !isValidGstin(gstin)) problems.push('the shop GSTIN is missing or not valid (Settings)');
  const sellerState = stateCodeOfGstin(gstin) ?? stateCodeOfName(branch?.state);
  const addr = branch?.address || tenant?.address;
  if (!addr) problems.push('the outlet address');
  if (!branch?.city) problems.push('the outlet city');
  if (!/^\d{6}$/.test(branch?.pincode ?? '')) problems.push('the outlet pincode (6 digits)');
  const seller = { Gstin: gstin, LglNm: tenant?.name, Addr1: (addr ?? '').slice(0, 100), Loc: branch?.city, Pin: Number(branch?.pincode), Stcd: sellerState };
  return { seller, problems, tenant };
}

function einvoiceBuyer(sale, customer, problems) {
  if (!sale.buyerGstin) problems.push('the customer has no GSTIN, so this is not a B2B bill');
  const buyerState = stateCodeOfGstin(sale.buyerGstin);
  if (!customer?.address) problems.push('the customer address');
  if (!customer?.city) problems.push('the customer city');
  if (!/^\d{6}$/.test(customer?.pincode ?? '')) problems.push('the customer pincode (6 digits)');
  return { Gstin: sale.buyerGstin, LglNm: customer?.name ?? sale.customerName, Pos: sale.placeOfSupply || buyerState, Addr1: (customer?.address ?? '').slice(0, 100), Loc: customer?.city, Pin: Number(customer?.pincode), Stcd: buyerState };
}

function fail(number, problems) {
  throw new ApiError(422, `${number}: add ${[...new Set(problems)].join(', ')} and try again.`);
}

function itemOf(n, l, taxable, gstAmt, inter, units, gross) {
  const rate = l.gstPercent ?? 0;
  const tot = r2(gross / (1 + rate / 100));
  const t = split(gstAmt, inter);
  return {
    SlNo: String(n),
    PrdDesc: l.name,
    IsServc: 'N',
    HsnCd: l.hsn,
    Qty: units,
    Unit: 'NOS',
    UnitPrice: r3(tot / units),
    TotAmt: tot,
    Discount: Math.max(0, r2(tot - taxable)),
    AssAmt: taxable,
    GstRt: rate,
    IgstAmt: t.igst,
    CgstAmt: t.cgst,
    SgstAmt: t.sgst,
    TotItemVal: r2(taxable + gstAmt),
    ...(l.batchNo ? { BchDtls: { Nm: l.batchNo, ...(l.expiryDate ? { ExpDt: ddmmyyyy(l.expiryDate) } : {}) } } : {}),
  };
}

function values(items, grand) {
  const s = (k) => r2(items.reduce((t, i) => t + i[k], 0));
  const sumItems = s('TotItemVal');
  return { AssVal: s('AssAmt'), CgstVal: s('CgstAmt'), SgstVal: s('SgstAmt'), IgstVal: s('IgstAmt'), RndOffAmt: r2(grand - sumItems), TotInvVal: r2(grand) };
}

async function customerOf(id) {
  const { Customer } = await import('../customers/customer.model.js');
  return id ? Customer.findById(id).lean() : null;
}

/** The e-invoice for one B2B bill (the file the IRP portal takes). */
export async function einvoiceForSale(sale) {
  if (!sale.buyerGstin) throw new ApiError(422, `${sale.number}: this bill is to a customer without a GSTIN (B2C), so it has no e-invoice. Only B2B bills do.`);
  const { seller, problems } = await parties(sale);
  const buyer = einvoiceBuyer(sale, await customerOf(sale.customerId), problems);
  if (sale.status === 'CANCELLED') problems.push('this bill is cancelled');
  if (sale.number.length > 16) problems.push('a shorter bill number (the portal allows 16 characters)');
  if (sale.lines.some((l) => !TEN_DIGITS.test(l.hsn ?? ''))) problems.push('an HSN code of 4 to 8 digits on every medicine');
  if (problems.length) fail(sale.number, problems);
  const items = sale.lines.map((l, i) => itemOf(i + 1, l, l.taxable, l.gst, sale.interState, l.units, l.gross));
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: sale.number, Dt: ddmmyyyy(sale.createdAt) },
    SellerDtls: seller,
    BuyerDtls: buyer,
    ItemList: items,
    ValDtls: values(items, sale.totals.grand),
  };
}

/** The e-invoice credit note for a return on a B2B bill. */
export async function einvoiceForReturn(ret) {
  const sale = await Sale.findById(ret.saleId).lean();
  if (!sale) throw ApiError.notFound('Bill not found');
  const { seller, problems } = await parties(sale);
  const buyer = einvoiceBuyer(sale, await customerOf(sale.customerId), problems);
  if (!ret.lines.length) problems.push('a return with items (this one only records a refund of a cancelled bill)');
  if (ret.number.length > 16) problems.push('a shorter credit note number');
  if (problems.length) fail(ret.number, problems);
  const items = ret.lines.map((rl, i) => {
    const l = sale.lines.find((x) => String(x.batchId) === String(rl.batchId));
    const t = refundTax(rl.refund, l.gstPercent ?? 0, sale.interState);
    return itemOf(i + 1, l, t.taxable, r2(t.igst + t.cgst + t.sgst), sale.interState, rl.units, rl.refund);
  });
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: 'CRN', No: ret.number, Dt: ddmmyyyy(ret.createdAt) },
    SellerDtls: seller,
    BuyerDtls: buyer,
    ItemList: items,
    ValDtls: values(items, items.reduce((t, i) => t + i.TotItemVal, 0)),
    RefDtls: { PrecDocDtls: [{ InvNo: sale.number, InvDt: ddmmyyyy(sale.createdAt) }] },
  };
}

/** All B2B bills of a month as one file. Bills that cannot be made yet are listed so they can be fixed. */
export async function einvoicesForMonth(opts, month) {
  const range = monthRange(month);
  const sales = await Sale.find({ ...scope(opts), supplyType: 'B2B', status: { $ne: 'CANCELLED' }, createdAt: { $gte: range.start, $lte: range.end } }).sort({ createdAt: 1 }).lean();
  const ok = [];
  const failed = [];
  for (const s of sales) {
    try {
      ok.push(await einvoiceForSale(s));
    } catch (e) {
      failed.push({ number: s.number, problem: e.message });
    }
  }
  return { invoices: ok, failed, total: sales.length };
}
