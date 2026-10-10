/** Reading a spreadsheet (.xlsx or .csv) in the browser and matching its columns to Orvia's fields. */

export interface Field {
  key: string;
  label: string;
  /** other names shops use for this column (matched ignoring case, spaces and punctuation) */
  aliases: string[];
  hint?: string;
}

export const STOCK_FIELDS: Field[] = [
  { key: 'name', label: 'Medicine name', aliases: ['medicine name', 'item name', 'product name', 'name', 'item', 'product', 'medicine', 'description', 'particulars'] },
  { key: 'manufacturer', label: 'Manufacturer', aliases: ['manufacturer', 'company', 'mfr', 'mfg', 'maker', 'mfg by', 'marketed by'] },
  { key: 'strength', label: 'Strength', aliases: ['strength', 'potency'] },
  { key: 'form', label: 'Form', aliases: ['form', 'dosage form', 'type'], hint: 'tablet, capsule, syrup, injection ...' },
  { key: 'composition', label: 'Composition', aliases: ['composition', 'salt', 'generic', 'generic name', 'contents'] },
  { key: 'packSize', label: 'Pack size', aliases: ['pack size', 'units per pack', 'pack', 'packing', 'unit'], hint: 'units in one pack, e.g. 10' },
  { key: 'barcode', label: 'Barcode', aliases: ['barcode', 'bar code', 'ean', 'ean13', 'ean 13'] },
  { key: 'batchNo', label: 'Batch no', aliases: ['batch', 'batch no', 'batch number', 'batchno', 'batch no.'] },
  { key: 'expiry', label: 'Expiry', aliases: ['expiry', 'expiry date', 'exp', 'exp date', 'exp.', 'expiry dt', 'expire'] },
  { key: 'mrp', label: 'MRP', aliases: ['mrp', 'm.r.p', 'm.r.p.', 'max retail price', 'retail price'] },
  { key: 'purchaseRate', label: 'Purchase rate', aliases: ['purchase rate', 'pur rate', 'purchase price', 'cost', 'cost price', 'p rate', 'prate', 'rate', 'ptr'] },
  { key: 'packs', label: 'Quantity (packs)', aliases: ['quantity', 'qty', 'packs', 'stock', 'closing stock', 'pack qty', 'current stock', 'balance', 'closing qty'] },
  { key: 'gst', label: 'GST %', aliases: ['gst', 'gst %', 'gst%', 'tax', 'tax %', 'tax%'] },
  { key: 'schedule', label: 'Schedule', aliases: ['schedule', 'sch', 'drug schedule'], hint: 'OTC, H, H1 ...' },
  { key: 'hsn', label: 'HSN', aliases: ['hsn', 'hsn code', 'hsn/sac'] },
  { key: 'rack', label: 'Rack / location', aliases: ['rack', 'location', 'shelf', 'rack no'] },
];

export const CUSTOMER_FIELDS: Field[] = [
  { key: 'name', label: 'Name', aliases: ['customer name', 'customer', 'party name', 'party', 'patient name', 'patient', 'name of customer'] },
  { key: 'phone', label: 'Phone', aliases: ['phone no', 'phone number', 'mobile', 'mobile no', 'mobile number', 'contact', 'contact no', 'cell'] },
  { key: 'email', label: 'Email', aliases: ['email id', 'e-mail', 'mail'] },
  { key: 'address', label: 'Address', aliases: ['addr', 'city'] },
  { key: 'openingBalance', label: 'Already owes (₹)', aliases: ['opening balance', 'balance', 'outstanding', 'due', 'dues', 'udhaar', 'pending', 'pending amount', 'closing balance', 'receivable'] },
  { key: 'creditLimit', label: 'Udhaar limit (₹)', aliases: ['credit limit', 'limit', 'udhaar limit'] },
  { key: 'notes', label: 'Notes', aliases: ['remarks', 'remark', 'note'] },
];

export const SUPPLIER_FIELDS: Field[] = [
  { key: 'name', label: 'Supplier name', aliases: ['name', 'party name', 'party', 'vendor', 'vendor name', 'distributor', 'stockist', 'company'] },
  { key: 'contactPerson', label: 'Contact person', aliases: ['contact name', 'person', 'contact person name', 'salesman', 'representative'] },
  { key: 'phone', label: 'Phone', aliases: ['phone no', 'phone number', 'mobile', 'mobile no', 'contact', 'contact no'] },
  { key: 'email', label: 'Email', aliases: ['email id', 'e-mail', 'mail'] },
  { key: 'gstin', label: 'GSTIN', aliases: ['gst', 'gst no', 'gst number', 'gstin no', 'gstin/uin'] },
  { key: 'drugLicenseNo', label: 'Drug licence no', aliases: ['dl no', 'dl', 'drug license', 'drug license no', 'drug licence', 'licence no', 'license no'] },
  { key: 'address', label: 'Address', aliases: ['addr'] },
  { key: 'city', label: 'City', aliases: ['town'] },
  { key: 'state', label: 'State', aliases: [] },
  { key: 'creditDays', label: 'Credit days', aliases: ['credit period', 'credit', 'terms', 'payment days'] },
  { key: 'openingBalance', label: 'We owe them (₹)', aliases: ['opening balance', 'balance', 'outstanding', 'payable', 'closing balance', 'amount due'] },
  { key: 'notes', label: 'Notes', aliases: ['remarks', 'remark', 'note'] },
];

const simple = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Best guess of which field each column of the sheet is. A field is given to the first column that matches it. */
export function guessMapping(headers: string[], fields: Field[]): (string | '')[] {
  const taken = new Set<string>();
  return headers.map((h) => {
    const s = simple(h);
    if (!s) return '';
    const f = fields.find((x) => !taken.has(x.key) && (simple(x.label) === s || x.aliases.some((a) => simple(a) === s)));
    if (f) taken.add(f.key);
    return f?.key ?? '';
  });
}

/** Template the shop can fill in. The one example row is deliberately not importable (it has no valid medicine). */
export function templateCsv(fields: Field[], exampleName: string | null = '(example) delete this row'): string {
  const head = fields.map((f) => f.label).join(',');
  if (exampleName === null) return '﻿' + head + '\r\n'; // a name alone would be a valid row, so no example
  const example = fields.map((f) => (f.key === 'name' ? exampleName : f.key === 'batchNo' ? 'A1B2' : f.key === 'expiry' ? '08/2027' : f.key === 'mrp' ? '42.50' : f.key === 'packs' ? '10' : '')).join(',');
  return '﻿' + head + '\r\n' + example + '\r\n';
}

export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV text to rows. Handles quotes, commas inside quotes, ; or tab as separator, and a leading BOM. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0];
  const sep = [',', ';', '\t'].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** One cell as a plain value. Excel dates become YYYY-MM-DD (read in UTC, which is how the sheet reader hands them over). */
function plain(v: unknown): string | number {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return v;
  return v === null || v === undefined ? '' : String(v);
}

/** The first sheet of an .xlsx or .csv file as rows of plain values. Row 1 is the column names. */
export async function readSheetFile(file: File): Promise<(string | number)[][]> {
  const lower = file.name.toLowerCase();
  let rows: unknown[][];
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) rows = parseCsv(await file.text());
  else if (lower.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    rows = (await readSheet(file)) as unknown[][];
  } else throw new Error('Choose an .xlsx or .csv file. (An old .xls file: open it in Excel and Save As .xlsx.)');
  return rows.map((r) => r.map(plain)).filter((r) => r.some((c) => String(c).trim() !== ''));
}
