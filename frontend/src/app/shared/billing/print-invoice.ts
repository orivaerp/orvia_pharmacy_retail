import { InvoiceRow } from './billing-types';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const lines = (s?: string) => esc(s).replace(/\r?\n/g, '<br>');

export type InvoiceLayout = 'classic' | 'modern' | 'compact';
export const INVOICE_LAYOUTS: { id: InvoiceLayout; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Plain black and white, easy on the printer.' },
  { id: 'modern', label: 'Modern', hint: 'A coloured header band with your logo, and a highlighted total.' },
  { id: 'compact', label: 'Compact', hint: 'A small, narrow invoice with just the essentials.' },
];

export interface InvoiceParty {
  name?: string;
  address?: string;
  gstin?: string;
  bankDetails?: string;
  phone?: string;
  // company only (Provider > Settings)
  pan?: string;
  email?: string;
  website?: string;
  logo?: string;
  note?: string;
  terms?: string;
  layout?: string;
  accent?: string;
}

const safeColour = (c?: string) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#0b3d3a');

/** One printable invoice as a page of HTML, in the layout the company chose. `autoPrint` opens the print dialog as soon as it loads. */
export function invoiceHtml(inv: InvoiceRow, company: InvoiceParty, shop: InvoiceParty, autoPrint = true): string {
  const paid = inv.status === 'paid';
  const layout: InvoiceLayout = company.layout === 'modern' || company.layout === 'compact' ? company.layout : 'classic';
  const accent = safeColour(company.accent);
  const stampColour = paid ? '#1a7f37' : '#b42318';
  const title = inv.gst > 0 ? 'Tax invoice' : 'Invoice';
  const status = paid ? 'PAID' : inv.status === 'void' ? 'VOID' : 'UNPAID';
  const name = company.name || 'Orvia';

  const contact = [company.phone && 'Phone: ' + esc(company.phone), company.email && esc(company.email), company.website && esc(company.website)].filter(Boolean).join(' &middot; ');
  const ids = [company.gstin && 'GSTIN: ' + esc(company.gstin), company.pan && 'PAN: ' + esc(company.pan)].filter(Boolean).join(' &middot; ');
  const companyBlock = `${company.logo && layout !== 'modern' ? `<img src="${esc(company.logo)}" alt="" class="logo">` : ''}<h1>${esc(name)}</h1>${company.address ? `<div>${lines(company.address)}</div>` : ''}${ids ? `<div>${ids}</div>` : ''}${contact ? `<div>${contact}</div>` : ''}`;
  const billedTo = `<h2>Billed to</h2><div><b>${esc(shop.name)}</b></div>${shop.address ? `<div>${lines(shop.address)}</div>` : ''}${shop.phone ? `<div>Phone: ${esc(shop.phone)}</div>` : ''}${shop.gstin ? `<div>GSTIN: ${esc(shop.gstin)}</div>` : ''}`;
  const meta = `<h2>${title}</h2><div><b>${esc(inv.number)}</b></div><div>Date: ${day(inv.issuedAt)}</div><div>Due: ${day(inv.dueDate)}</div>`;
  const stamp = `<span class="stamp">${status}</span>`;
  const table = `<table><tr><th>Description</th><th class="r">Amount</th></tr>
<tr><td>Orvia ${esc(inv.planName)} plan, ${inv.cycle}<br><small>${day(inv.periodStart)} to ${day(inv.periodEnd)}</small></td><td class="r">${inr(inv.amount)}</td></tr>
${inv.gst > 0 ? `<tr><td>GST @ ${inv.gstPercent}%</td><td class="r">${inr(inv.gst)}</td></tr>` : ''}
<tr class="total"><td>Total</td><td class="r">${inr(inv.total)}</td></tr></table>`;
  const pay = paid
    ? `<p>Paid on ${day(inv.paidAt ?? inv.issuedAt)} by ${esc(inv.method)}${inv.reference ? ' (ref ' + esc(inv.reference) + ')' : ''}.</p>`
    : company.bankDetails
      ? `<p><b>Pay by bank transfer:</b> ${lines(company.bankDetails)}<br><small>Mention ${esc(inv.number)} as the reference.</small></p>`
      : '';
  const terms = company.terms ? `<div class="terms"><h2>Terms</h2><div>${lines(company.terms)}</div></div>` : '';
  const note = company.note ? `<p class="note"><small>${esc(company.note)}</small></p>` : '';

  const base = `*{box-sizing:border-box}small{color:#555}@page{margin:12mm}img.logo{max-height:56px;max-width:200px;display:block;margin-bottom:6px}
h2{font-size:12px;margin:0 0 4px;color:#555;text-transform:uppercase;letter-spacing:.05em}.r{text-align:right}.stamp{display:inline-block;border:2px solid ${stampColour};color:${stampColour};padding:2px 10px;border-radius:6px;font-weight:700}
table{width:100%;border-collapse:collapse}th,td{padding:8px 0;text-align:left;vertical-align:top}th.r,td.r{text-align:right}.terms{margin-top:14px}.terms div{white-space:normal}.note{margin-top:16px}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;

  let css: string;
  let body: string;
  if (layout === 'modern') {
    css = `${base}body{font:13px/1.5 system-ui,sans-serif;margin:0 auto;max-width:760px;color:#111}
.band{background:${accent};color:#fff;padding:22px 28px;display:flex;justify-content:space-between;gap:24px}.band h1{font-size:24px;margin:0}.band h2{color:#ffffffcc}.band img.logo{background:#fff;padding:4px;border-radius:6px}
.inner{padding:22px 28px}.row{display:flex;justify-content:space-between;gap:24px}.card{background:#f5f7f7;border-radius:10px;padding:12px 14px}
table{margin-top:18px}th{background:${accent};color:#fff;padding:8px 10px}td{padding:10px;border-bottom:1px solid #e2e5e5}.total td{background:${accent}14;font-weight:700;font-size:16px;border-bottom:0}`;
    body = `<div class="band"><div>${company.logo ? `<img src="${esc(company.logo)}" alt="" class="logo">` : ''}<h1>${esc(name)}</h1>${company.address ? `<div>${lines(company.address)}</div>` : ''}${ids ? `<div>${ids}</div>` : ''}${contact ? `<div>${contact}</div>` : ''}</div>
<div class="r">${meta}<div style="margin-top:8px"><span class="stamp" style="background:#fff">${status}</span></div></div></div>
<div class="inner"><div class="row"><div class="card" style="min-width:240px">${billedTo}</div></div>${table}${pay}${terms}${note}</div>`;
  } else if (layout === 'compact') {
    css = `${base}body{font:12px/1.4 system-ui,sans-serif;margin:0 auto;padding:16px;max-width:520px;color:#000}h1{font-size:17px;margin:0}
.head{text-align:center;border-bottom:1px dashed #000;padding-bottom:8px}.two{display:flex;justify-content:space-between;gap:12px;margin:10px 0}table{margin-top:6px}th,td{padding:4px 0;border-bottom:1px dotted #999}.total td{font-weight:700;font-size:14px;border-bottom:1px solid #000}
img.logo{margin:0 auto 4px}`;
    body = `<div class="head">${companyBlock}</div>
<div class="two"><div>${meta}</div><div class="r">${stamp}</div></div>
<div>${billedTo}</div>${table}${pay}${terms}${note}`;
  } else {
    css = `${base}body{font:13px/1.5 system-ui,sans-serif;margin:0 auto;padding:24px;max-width:720px;color:#000}h1{font-size:22px;margin:0}
.row{display:flex;justify-content:space-between;gap:24px;margin-top:18px}table{margin-top:18px}th,td{border-bottom:1px solid #ccc}.total td{font-weight:700;font-size:15px;border-bottom:2px solid #000}`;
    body = `<div class="row" style="margin-top:0"><div>${companyBlock}</div><div class="r">${meta}<div style="margin-top:6px">${stamp}</div></div></div>
<div class="row"><div>${billedTo}</div></div>${table}${pay}${terms}${note}`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title><style>${css}</style></head><body>${body}${autoPrint ? '<script>window.onload=function(){window.print()}</script>' : ''}</body></html>`;
}

/** Opens a tax invoice in a new window and prints it. Returns false if the pop-up was blocked. */
export function printInvoice(inv: InvoiceRow, company: InvoiceParty, shop: InvoiceParty): boolean {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return false;
  w.document.write(invoiceHtml(inv, company, shop, true));
  w.document.close();
  return true;
}

/** Shows a sample invoice with the given company details, without printing: the provider checks the look before saving. */
export function previewInvoice(company: InvoiceParty): boolean {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 86_400_000);
  const sample = {
    _id: 'sample', number: 'INV-SAMPLE-000001', tenantId: 'sample', tenantName: 'Sample Pharmacy', planName: 'Pro', cycle: 'monthly',
    periodStart: now.toISOString(), periodEnd: end.toISOString(), amount: 999, gstPercent: 18, gst: 179.82, total: 1178.82, status: 'issued',
    issuedAt: now.toISOString(), dueDate: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
  } as InvoiceRow;
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return false;
  w.document.write(invoiceHtml(sample, company, { name: 'Sample Pharmacy', address: '12 Market Road, Lucknow', gstin: '09ABCDE1234F1Z5', phone: '9876543210' }, false));
  w.document.close();
  return true;
}
