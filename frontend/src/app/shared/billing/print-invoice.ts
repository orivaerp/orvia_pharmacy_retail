import { InvoiceRow } from './billing-types';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

export interface InvoiceParty {
  name?: string;
  address?: string;
  gstin?: string;
  bankDetails?: string;
  phone?: string;
}

/** Opens a plain A4 tax invoice in a new window and prints it. Returns false if the pop-up was blocked. */
export function printInvoice(inv: InvoiceRow, company: InvoiceParty, shop: InvoiceParty): boolean {
  const paid = inv.status === 'paid';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title>
<style>
body{font:13px/1.5 system-ui,sans-serif;margin:0 auto;padding:24px;max-width:720px;color:#000}
h1{font-size:22px;margin:0}h2{font-size:12px;margin:0 0 4px;color:#555;text-transform:uppercase;letter-spacing:.05em}
.row{display:flex;justify-content:space-between;gap:24px;margin-top:18px}.r{text-align:right}
table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:8px 0;border-bottom:1px solid #ccc;text-align:left}th.r,td.r{text-align:right}
.total td{font-weight:700;font-size:15px;border-bottom:2px solid #000}.stamp{display:inline-block;border:2px solid ${paid ? '#1a7f37' : '#b42318'};color:${paid ? '#1a7f37' : '#b42318'};padding:2px 10px;border-radius:6px;font-weight:700}
small{color:#555}@page{margin:12mm}
</style></head><body>
<div class="row" style="margin-top:0"><div><h1>${esc(company.name ?? 'Orvia')}</h1><div>${esc(company.address)}</div>${company.gstin ? `<div>GSTIN: ${esc(company.gstin)}</div>` : ''}</div>
<div class="r"><h2>Tax invoice</h2><div><b>${esc(inv.number)}</b></div><div>Date: ${day(inv.issuedAt)}</div><div>Due: ${day(inv.dueDate)}</div><div style="margin-top:6px"><span class="stamp">${paid ? 'PAID' : inv.status === 'void' ? 'VOID' : 'UNPAID'}</span></div></div></div>
<div class="row"><div><h2>Billed to</h2><div><b>${esc(shop.name)}</b></div><div>${esc(shop.address)}</div>${shop.gstin ? `<div>GSTIN: ${esc(shop.gstin)}</div>` : ''}</div></div>
<table><tr><th>Description</th><th class="r">Amount</th></tr>
<tr><td>Orvia ${esc(inv.planName)} plan, ${inv.cycle}<br><small>${day(inv.periodStart)} to ${day(inv.periodEnd)}</small></td><td class="r">${inr(inv.amount)}</td></tr>
<tr><td>GST @ ${inv.gstPercent}%</td><td class="r">${inr(inv.gst)}</td></tr>
<tr class="total"><td>Total</td><td class="r">${inr(inv.total)}</td></tr></table>
${paid ? `<p>Paid on ${day(inv.paidAt ?? inv.issuedAt)} by ${esc(inv.method)}${inv.reference ? ' (ref ' + esc(inv.reference) + ')' : ''}.</p>` : company.bankDetails ? `<p><b>Pay by bank transfer:</b> ${esc(company.bankDetails)}<br><small>Mention ${esc(inv.number)} as the reference.</small></p>` : ''}
<p><small>This is a computer-generated invoice.</small></p>
<script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
