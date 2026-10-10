import { ean13Svg, isEan13 } from '../../shared/utils/barcode';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export type LabelSize = 'roll' | 'sheet';
export const LABEL_SIZES: { id: LabelSize; label: string }[] = [
  { id: 'roll', label: 'Label roll 50 × 25 mm' },
  { id: 'sheet', label: 'A4 sheet, 3 across' },
];

export interface LabelJob {
  name: string;
  code: string;
  mrp?: number;
  copies: number;
  size: LabelSize;
}

/** Only a valid EAN-13 can be drawn here. Others (e.g. an old 8-digit code) can be replaced with a shop barcode. */
export const canPrintLabel = (code: string) => isEan13(code);

/** Opens a page of barcode labels in a new window and prints it. Returns false if the browser blocked the window. */
export function printLabels(j: LabelJob): boolean {
  const roll = j.size === 'roll';
  const label = `<div class="l"><div class="n">${esc(j.name)}</div><div class="bc">${ean13Svg(j.code)}</div><div class="c">${esc(j.code)}</div>${
    j.mrp ? `<div class="m">MRP ₹${j.mrp.toFixed(2)}</div>` : ''
  }</div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
${roll ? '@page{size:50mm 25mm;margin:0}body{margin:0}.l{width:50mm;height:25mm;page-break-after:always}' : '@page{size:A4;margin:8mm 6mm}body{margin:0;display:grid;grid-template-columns:repeat(3,64mm);gap:2mm 2mm}.l{width:64mm;height:30mm;outline:1px dashed #ccc}'}
.l{box-sizing:border-box;padding:1.5mm 2.5mm;overflow:hidden;font:8px/1.15 system-ui,sans-serif;text-align:center;color:#000}
.n{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bc{height:${roll ? 11 : 14}mm;margin:0.6mm auto 0}.bc svg{width:100%;height:100%;display:block}
.c{letter-spacing:.6px}.m{font-weight:700;font-size:9px}
@media print{.l{outline:none}}
</style></head><body>${Array.from({ length: Math.min(500, Math.max(1, j.copies)) }, () => label).join('')}
<script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open('', '_blank', 'width=760,height=720');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
