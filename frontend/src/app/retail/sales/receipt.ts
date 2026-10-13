import { SaleDetail } from './sales-api.service';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const money = (n: number) => n.toFixed(2);
const monthYear = (d: string) => {
  const x = new Date(d);
  return `${String(x.getUTCMonth() + 1).padStart(2, '0')}/${String(x.getUTCFullYear()).slice(2)}`;
};

/** Opens a plain, printer-friendly bill (GST summary included) in a new window and prints it. */
export type Paper = 'a4' | 'thermal';
const PAPER_KEY = 'orvia.paper';

export function savedPaper(): Paper {
  try {
    return localStorage.getItem(PAPER_KEY) === 'thermal' ? 'thermal' : 'a4';
  } catch {
    return 'a4';
  }
}

export function savePaper(p: Paper) {
  try {
    localStorage.setItem(PAPER_KEY, p);
  } catch {}
}

/** The bill as one printable page of HTML. `autoPrint` opens the print dialog as soon as it loads (the customer's page does not). */
export function receiptHtml(sale: SaleDetail, paper: Paper = 'a4', autoPrint = true): string {
  const thermal = paper === 'thermal';
  const b = sale.branchId;
  const shop = sale.shop;
  const place = [b?.address || shop?.address, b?.city, [b?.state, b?.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const phone = b?.phone || shop?.phone;
  const gstin = b?.gstin || shop?.gstin;
  const dl = b?.drugLicenseNo || shop?.drugLicenseNo;
  const title = shop?.name ?? b?.name ?? 'Pharmacy';
  const outletLine = b && shop && b.name !== shop.name ? b.name : '';
  const doctor = (n: string) => (/^dr[. ]/i.test(n.trim()) ? n.trim() : 'Dr ' + n.trim());
  const rows = sale.lines
    .map((l) => {
      const packs = Math.floor(l.units / l.unitsPerPack);
      const loose = l.units % l.unitsPerPack;
      const qty = `${packs ? packs : ''}${loose ? (packs ? '+' : '') + loose + 'u' : ''}`;
      return `<tr><td>${esc(l.name)}<br><small>B:${esc(l.batchNo)} Exp:${monthYear(l.expiryDate)}</small></td><td class="r">${qty}</td><td class="r">${money(l.mrp)}</td><td class="r">${money(l.total)}</td></tr>`;
    })
    .join('');

  const gstRates = [...new Set(sale.lines.map((l) => l.gstPercent))].sort((a, b2) => a - b2);
  const gstRows = gstRates
    .map((r) => {
      const ls = sale.lines.filter((l) => l.gstPercent === r);
      const taxable = ls.reduce((s, l) => s + l.taxable, 0);
      const gst = ls.reduce((s, l) => s + l.gst, 0);
      if (sale.interState) return `<tr><td>GST ${r}%</td><td class="r">${money(taxable)}</td><td class="r" colspan="2">IGST ${money(gst)}</td></tr>`;
      return `<tr><td>GST ${r}%</td><td class="r">${money(taxable)}</td><td class="r">CGST ${money(gst / 2)}</td><td class="r">SGST ${money(gst / 2)}</td></tr>`;
    })
    .join('');

  const rx = sale.prescriber?.doctorName
    ? `<p><b>Rx:</b> ${esc(doctor(sale.prescriber.doctorName))}${sale.prescriber.regNo ? ' (Reg ' + esc(sale.prescriber.regNo) + ')' : ''} &middot; Patient ${esc(sale.prescriber.patientName)}</p>`
    : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.number)}</title>
<style>
${thermal ? 'body{font:11px/1.35 system-ui,sans-serif;margin:0;padding:0;width:72mm;color:#000}' : 'body{font:13px/1.45 system-ui,sans-serif;margin:0 auto;padding:12px;max-width:680px;color:#000}'}hr{border:0;border-top:1px dashed #000;margin:6px 0}
h1{font-size:${thermal ? 15 : 20}px;margin:0;text-align:center}p{margin:2px 0}.c{text-align:center}
table{width:100%;border-collapse:collapse;margin:6px 0}th,td{padding:2px 0;vertical-align:top;text-align:left}
th{border-bottom:1px dashed #000}tr.t td{border-top:1px dashed #000;font-weight:700;font-size:14px}.r{text-align:right}small{color:#444}
${thermal ? '@page{size:80mm auto;margin:4mm 3mm}' : '@page{margin:10mm}'}
</style></head><body>
<h1>${esc(title)}</h1>
${outletLine ? `<p class="c"><b>${esc(outletLine)}</b></p>` : ''}
${place ? `<p class="c">${esc(place)}</p>` : ''}
${phone ? `<p class="c">Phone: ${esc(phone)}</p>` : ''}
<p class="c">${gstin ? 'GSTIN: ' + esc(gstin) : ''}${gstin && dl ? ' &middot; ' : ''}${dl ? 'Drug Lic: ' + esc(dl) : ''}</p>
${b?.pharmacistName ? `<p class="c">Pharmacist: ${esc(b.pharmacistName)}${b.pharmacistRegNo ? ' (Reg ' + esc(b.pharmacistRegNo) + ')' : ''}</p>` : ''}
<hr>
${sale.status === 'CANCELLED' ? `<p class="c"><b>*** BILL CANCELLED ***</b></p>` : ''}
<p><b>${esc(sale.number)}</b> &middot; ${new Date(sale.createdAt).toLocaleString('en-IN')}</p>
${sale.customerName ? `<p>Customer: ${esc(sale.customerName)}${sale.customerPhone ? ' (' + esc(sale.customerPhone) + ')' : ''}${sale.buyerGstin ? ' &middot; GSTIN ' + esc(sale.buyerGstin) : ''}</p>` : ''}
${rx}
<table><tr><th>Item</th><th class="r">Qty</th><th class="r">MRP</th><th class="r">Amt</th></tr>${rows}
${sale.totals.discount ? `<tr><td colspan="3">Discount</td><td class="r">-${money(sale.totals.discount)}</td></tr>` : ''}
${sale.totals.roundOff ? `<tr><td colspan="3">Round off</td><td class="r">${money(sale.totals.roundOff)}</td></tr>` : ''}
<tr class="t"><td colspan="3">TOTAL</td><td class="r">${money(sale.totals.grand)}</td></tr></table>
<p>Paid: ${sale.payments.map((p) => `${p.mode} ${money(p.amount)}`).join(', ')}</p>
<table><tr><th>Tax</th><th class="r">Taxable</th><th class="r"></th><th class="r"></th></tr>${gstRows}</table>
<p class="c">MRP is inclusive of GST. Thank you!</p>
${autoPrint ? '<script>window.onload=function(){window.print()}</script>' : ''}
</body></html>`;
  return html;
}

export function printReceipt(sale: SaleDetail, paper: Paper = savedPaper()): boolean {
  const html = receiptHtml(sale, paper, true);
  const w = window.open('', '_blank', 'width=760,height=720');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
