import { ApiError } from '../../utils/ApiError.js';
import { Branch } from '../branches/branch.model.js';
import { Medicine } from '../medicines/medicine.model.js';
import { assertWithinLimit } from '../plans/plan.service.js';
import { Product, toView } from '../products/product.model.js';
import { createStockEntry } from '../stock/stock.service.js';
import { Batch, endOfMonth } from '../stock/stock.model.js';
import { key, readRow } from './parse.js';

export const MAX_ROWS = 2000;
const CHUNK = 100;
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const masterOf = (p) => String(p.doc.masterId?._id ?? p.doc.masterId ?? '');

/**
 * Works out, for every row of an uploaded sheet, which product it is (one the shop already has, a medicine from the
 * Orvia catalog, or a new private product) and whether its stock can be added. Reads only; nothing is written.
 */
export async function analyse(user, { branchId, rows }) {
  if (!Array.isArray(rows) || !rows.length) throw ApiError.badRequest('The file has no rows');
  if (rows.length > MAX_ROWS) throw ApiError.badRequest(`Import up to ${MAX_ROWS} rows at a time. Split the file and import it in parts.`);
  const branch = await Branch.findById(branchId);
  if (!branch || !branch.isActive) throw ApiError.badRequest('Choose an active outlet');

  const shop = (await Product.find({}).populate('masterId')).map((doc) => ({ doc, v: toView(doc) }));
  const byBarcode = new Map();
  for (const p of shop) for (const b of p.v.barcodes) byBarcode.set(b, p);
  const byName = new Map();
  for (const p of shop) {
    const k = key(p.v.name);
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const byMaster = new Map(shop.filter((p) => masterOf(p)).map((p) => [masterOf(p), p]));
  const batches = await Batch.find({ branchId }).select('productId batchNo expiryDate mrp quantity').lean();
  const batchOf = new Map(batches.map((b) => [`${b.productId}|${b.batchNo}`, b]));

  // when several match, use whatever the sheet says (strength, manufacturer, form) to pick one
  const narrow = (list, r, get) => ['strength', 'manufacturer', 'form'].reduce((acc, f) => (r[f] && acc.length > 1 ? acc.filter((x) => key(get(x)[f]) === key(r[f])) : acc), list);

  const planned = new Map(); // a product that will be made, keyed so rows of the same medicine share it
  const seenBatch = new Map();
  const out = [];

  for (let i = 0; i < rows.length; i++) {
    const { out: r, errors } = readRow(rows[i]);
    const row = { row: i + 2, name: r.name ?? '', errors, warnings: [], action: null, productLabel: '' };
    out.push(row);
    if (errors.length) continue;

    // ---- which product is it?
    let hit = null; // { kind: 'existing' | 'catalog' | 'custom', ... }
    if (r.barcode) {
      const p = byBarcode.get(r.barcode);
      if (p) hit = { kind: 'existing', p };
      else {
        const m = await Medicine.findOne({ barcodes: r.barcode, status: 'verified' }).lean();
        if (m) hit = byMaster.has(String(m._id)) ? { kind: 'existing', p: byMaster.get(String(m._id)) } : { kind: 'catalog', m };
      }
    }
    if (!hit) {
      const mine = narrow(byName.get(key(r.name)) ?? [], r, (x) => x.v);
      if (mine.length === 1) hit = { kind: 'existing', p: mine[0] };
      else if (mine.length > 1) {
        row.errors.push(`${mine.length} of your products are called "${r.name}". Add Strength, Manufacturer or Form to say which one.`);
        continue;
      }
    }
    if (!hit) {
      const found = await Medicine.find({ name: new RegExp(`^${escapeRx(r.name)}$`, 'i'), status: 'verified' }).limit(30).lean();
      const cands = narrow(found, r, (m) => m);
      if (cands.length === 1) hit = byMaster.has(String(cands[0]._id)) ? { kind: 'existing', p: byMaster.get(String(cands[0]._id)) } : { kind: 'catalog', m: cands[0] };
      else if (cands.length > 1) {
        row.errors.push(`${cands.length} medicines in the Orvia catalog are called "${r.name}". Add Strength, Manufacturer or Form to say which one.`);
        continue;
      }
    }
    if (!hit) {
      if (!r.form || r.gst === undefined) {
        row.errors.push('Not in the Orvia catalog. To create it as your own product, fill Form and GST %.');
        continue;
      }
      hit = { kind: 'custom' };
    }

    // ---- what will happen to the product
    let productKey;
    if (hit.kind === 'existing') {
      row.action = 'existing';
      row.productLabel = hit.p.v.name;
      productKey = `p:${hit.p.doc._id}`;
    } else if (hit.kind === 'catalog') {
      row.action = 'catalog';
      row.productLabel = `${hit.m.name} (${hit.m.manufacturer})`;
      productKey = `m:${hit.m._id}`;
    } else {
      row.action = 'custom';
      row.productLabel = r.name;
      productKey = `c:${key(r.name)}|${key(r.strength)}|${key(r.form)}|${key(r.manufacturer)}`;
    }
    row.productKey = productKey;
    row.newProduct = row.action !== 'existing' && !planned.has(productKey);
    if (row.newProduct) planned.set(productKey, { hit, r });
    row.hit = hit;
    row.r = r;
    if (r.barcode && hit.kind === 'existing' && !byBarcode.has(r.barcode)) row.warnings.push('This barcode will be saved on the product so it scans at the counter');

    // ---- stock
    if (!(r.packs > 0)) {
      row.warnings.push('No quantity: the product is added without stock');
      continue;
    }
    if (endOfMonth(r.expiry) < new Date()) {
      row.errors.push(`Batch ${r.batchNo} has already expired (${r.expiry})`);
      continue;
    }
    const bk = `${productKey}|${r.batchNo}`;
    const first = seenBatch.get(bk);
    if (first) {
      if (first.expiry !== r.expiry || first.mrp !== r.mrp) {
        row.errors.push(`Batch ${r.batchNo} appears twice with a different expiry or MRP (see row ${first.row})`);
        continue;
      }
      row.warnings.push(`Batch ${r.batchNo} appears twice in the file; the quantities are added together`);
    } else seenBatch.set(bk, { row: row.row, expiry: r.expiry, mrp: r.mrp });
    if (hit.kind === 'existing') {
      const old = batchOf.get(`${hit.p.doc._id}|${r.batchNo}`);
      if (old) {
        if (old.expiryDate.getTime() !== endOfMonth(r.expiry).getTime() || old.mrp !== r.mrp) {
          row.errors.push(`Batch ${r.batchNo} is already in your stock with a different expiry or MRP. A batch has one expiry and one MRP.`);
          continue;
        }
        row.batchExists = true;
        row.warnings.push(`Batch ${r.batchNo} is already in stock (${Math.floor(old.quantity / (hit.p.v.unitsPerPack || 1))} packs). These packs will be ADDED to it`);
      }
    }
  }

  // a product that only had error rows is not made
  const good = out.filter((r) => !r.errors.length);
  const goodKeys = new Set(good.map((r) => r.productKey));
  for (const k of [...planned.keys()]) if (!goodKeys.has(k)) planned.delete(k);

  let limitError = null;
  if (planned.size) {
    try {
      await assertWithinLimit(user.tenantId, 'products', planned.size);
    } catch (e) {
      limitError = e.message;
    }
  }
  return {
    branch,
    rows: out,
    good,
    planned,
    summary: {
      rows: out.length,
      ok: good.length,
      errors: out.length - good.length,
      newProducts: planned.size,
      stockRows: good.filter((r) => r.r.packs > 0).length,
      packs: good.reduce((s, r) => s + (r.r.packs || 0), 0),
      batchesAlreadyInStock: good.filter((r) => r.batchExists).length,
      limitError,
    },
  };
}

/** What the screen shows: no internals. */
export function previewOf(a) {
  return {
    summary: a.summary,
    rows: a.rows.map((r) => ({ row: r.row, name: r.name, action: r.action, product: r.productLabel, newProduct: Boolean(r.newProduct), errors: r.errors, warnings: r.warnings })),
  };
}

/** Does the import: makes the new products, then puts the stock in (100 lines per transaction). Rows with errors are skipped. */
export async function commit(user, input) {
  const a = await analyse(user, input);
  if (a.summary.limitError) throw ApiError.forbidden(a.summary.limitError);
  if (a.summary.batchesAlreadyInStock && !input.confirmAdd) {
    throw ApiError.conflict(`${a.summary.batchesAlreadyInStock} row(s) are batches already in your stock; importing would add to them. Confirm to continue, or remove those rows.`);
  }
  if (!a.good.length) throw ApiError.badRequest('There are no valid rows to import');

  // 1. products
  const made = new Map(); // productKey -> Product doc
  const toMaster = [...a.planned.entries()].filter(([, v]) => v.hit.kind === 'catalog');
  if (toMaster.length) {
    const usable = async (code, m) => code && !(await Product.exists({ barcodes: code })) && !(await Medicine.exists({ barcodes: code, _id: { $ne: m._id } })) && !(m.barcodes ?? []).includes(code);
    const docs = [];
    const used = new Set();
    for (const [, v] of toMaster) {
      const code = v.r.barcode;
      const ok = (await usable(code, v.hit.m)) && !used.has(code);
      if (ok) used.add(code);
      docs.push(...(await Product.insertMany([{ masterId: v.hit.m._id, location: v.r.rack ?? '', barcodes: ok ? [code] : [] }])));
    }
    toMaster.forEach(([k], n) => made.set(k, docs[n]));
  }
  for (const [k, v] of a.planned.entries()) {
    if (v.hit.kind !== 'custom') continue;
    const r = v.r;
    const taken = r.barcode && (await Product.exists({ barcodes: r.barcode }));
    made.set(
      k,
      await Product.create({
        name: r.name,
        composition: [r.composition ?? r.name],
        strength: r.strength ?? '',
        form: r.form,
        unitsPerPack: r.unitsPerPack ?? 1,
        manufacturer: r.manufacturer ?? 'Unknown',
        hsn: r.hsn ?? '3004',
        gstPercent: r.gst,
        schedule: r.schedule ?? 'OTC',
        barcodes: r.barcode && !taken ? [r.barcode] : [],
        location: r.rack ?? '',
        isCustom: true,
      }),
    );
  }
  // existing products: remember a scanned barcode and the rack if they had none
  const seenCode = new Set();
  for (const row of a.good) {
    if (row.action !== 'existing') continue;
    const p = row.hit.p.doc;
    const code = row.r.barcode;
    let changed = false;
    if (code && !p.barcodes.includes(code) && !seenCode.has(code) && !(await Product.exists({ barcodes: code }))) {
      p.barcodes.push(code);
      seenCode.add(code);
      changed = true;
    }
    if (row.r.rack && !p.location) {
      p.location = row.r.rack;
      changed = true;
    }
    if (changed) await p.save();
  }

  // 2. stock
  const lines = a.good
    .filter((r) => r.r.packs > 0)
    .map((r) => ({ row: r.row, productId: String(r.action === 'existing' ? r.hit.p.doc._id : made.get(r.productKey)._id), batchNo: r.r.batchNo, expiry: r.r.expiry, mrp: r.r.mrp, purchaseRate: r.r.purchaseRate ?? 0, packs: r.r.packs }));
  let packs = 0;
  let imported = 0;
  const failed = [];
  for (let i = 0; i < lines.length; i += CHUNK) {
    const chunk = lines.slice(i, i + CHUNK);
    try {
      await createStockEntry(user, { branchId: input.branchId, type: 'OPENING', reference: 'Excel import', lines: chunk.map(({ row, ...l }) => l) });
      imported += chunk.length;
      packs += chunk.reduce((s, l) => s + l.packs, 0);
    } catch (e) {
      failed.push({ rows: `${chunk[0].row}-${chunk[chunk.length - 1].row}`, reason: e.message });
    }
  }
  return {
    productsAdded: made.size,
    stockRows: imported,
    packs,
    skipped: a.rows.filter((r) => r.errors.length).map((r) => ({ row: r.row, name: r.name, reason: r.errors[0] })),
    failed,
    outlet: a.branch.name,
  };
}
