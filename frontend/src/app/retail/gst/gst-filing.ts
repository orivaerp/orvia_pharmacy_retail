import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';

interface Money {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
}
interface Item extends Money {
  rate: number;
}
interface Doc {
  ctin: string;
  buyer?: string;
  number: string;
  date: string;
  value: number;
  pos: string;
  invoice?: string;
  items: Item[];
}
interface Gstr1 {
  month: string;
  gstin: string;
  warnings: string[];
  counts: { bills: number; cancelled: number; creditNotes: number; b2b: number };
  b2b: Doc[];
  b2cs: (Item & { pos: string })[];
  nil: Item[];
  cdnr: Doc[];
  hsn: (Item & { hsn: string; description: string; qty: number; value: number })[];
  docs: { name: string; from: string; to: string; total: number; cancelled: number; net: number }[];
  totals: Money;
}
interface Gstr3b {
  gstin: string;
  warnings: string[];
  outward: Money;
  nilTaxable: number;
  itc: { igst: number; cgst: number; sgst: number };
  net: { igst: number; cgst: number; sgst: number };
}
interface EinvoiceStatus {
  total: number;
  ready: number;
  failed: { number: string; problem: string }[];
}

const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 7);

/**
 * GST filing: the month's GSTR-1 and GSTR-3B figures, and e-invoice files for bills to businesses.
 * Orvia works the figures out and gives the files; it does not file anything. The owner or the accountant checks them and uploads.
 */
@Component({
  selector: 'app-gst-filing',
  imports: [FormsModule, DecimalPipe],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">GST filing</h1>
    <p class="mt-0.5 text-xs text-ink-soft">{{ ctx.selectedOutlet() ? ctx.selectedOutlet()!.name : 'All your outlets' }}. Figures for GSTR-1, GSTR-3B and e-invoice, made from your bills, returns and purchases. Orvia does not file for you: download the file and upload it on the GST portal, or give it to your accountant.</p>

    <div class="mt-3 flex flex-wrap items-end gap-2">
      <div><label class="label" for="g-month">Month</label><input id="g-month" type="month" class="field" [ngModel]="month()" (ngModelChange)="month.set($event); load()" /></div>
    </div>
    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-white/60 px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (r1(); as f) {
      @for (w of f.warnings; track w) { <p class="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{{ w }}</p> }

      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-base font-medium">GSTR-1: what you sold</h2>
            <p class="text-[11px] text-ink-soft">GSTIN {{ f.gstin || 'not set' }} · {{ f.counts.bills }} bills ({{ f.counts.b2b }} to businesses), {{ f.counts.creditNotes }} credit notes, {{ f.counts.cancelled }} cancelled</p>
          </div>
          <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="get('gstr1/json', 'json')">Download JSON for the portal</button>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          <div class="rounded-xl bg-white/50 p-2"><div class="text-ink-soft">Taxable value</div><b>₹{{ f.totals.taxable | number: '1.2-2' }}</b></div>
          <div class="rounded-xl bg-white/50 p-2"><div class="text-ink-soft">CGST</div><b>₹{{ f.totals.cgst | number: '1.2-2' }}</b></div>
          <div class="rounded-xl bg-white/50 p-2"><div class="text-ink-soft">SGST</div><b>₹{{ f.totals.sgst | number: '1.2-2' }}</b></div>
          <div class="rounded-xl bg-white/50 p-2"><div class="text-ink-soft">IGST</div><b>₹{{ f.totals.igst | number: '1.2-2' }}</b></div>
          <div class="rounded-xl bg-white/50 p-2"><div class="text-ink-soft">Total tax</div><b>₹{{ f.totals.igst + f.totals.cgst + f.totals.sgst | number: '1.2-2' }}</b></div>
        </div>
        <p class="mt-2 text-[11px] text-ink-soft">After returns. A bill cancelled in the month it was made is left out; a return is a credit note in the month it was made.</p>

        <h3 class="mt-4 text-sm font-medium">Sales to customers without a GSTIN (B2CS)</h3>
        <div class="overflow-x-auto">
          <table class="mt-1 w-full min-w-120 text-left text-xs">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1 pr-3 font-normal">Rate</th><th class="py-1 pr-3 font-normal">State</th><th class="py-1 pr-3 text-right font-normal">Taxable</th><th class="py-1 pr-3 text-right font-normal">CGST</th><th class="py-1 pr-3 text-right font-normal">SGST</th><th class="py-1 text-right font-normal">IGST</th></tr></thead>
            <tbody>
              @for (r of f.b2cs; track r.rate + r.pos) {
                <tr class="border-t border-line"><td class="py-1 pr-3">{{ r.rate }}%</td><td class="py-1 pr-3">{{ r.pos }}</td><td class="py-1 pr-3 text-right">{{ r.taxable | number: '1.2-2' }}</td><td class="py-1 pr-3 text-right">{{ r.cgst | number: '1.2-2' }}</td><td class="py-1 pr-3 text-right">{{ r.sgst | number: '1.2-2' }}</td><td class="py-1 text-right">{{ r.igst | number: '1.2-2' }}</td></tr>
              } @empty { <tr><td colspan="6" class="py-3 text-center text-ink-soft">Nothing this month.</td></tr> }
            </tbody>
          </table>
        </div>

        <h3 class="mt-4 text-sm font-medium">Invoices to businesses (B2B)</h3>
        <div class="overflow-x-auto">
          <table class="mt-1 w-full min-w-136 text-left text-xs">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1 pr-3 font-normal">Bill</th><th class="py-1 pr-3 font-normal">Customer</th><th class="py-1 pr-3 font-normal">GSTIN</th><th class="py-1 pr-3 font-normal">State</th><th class="py-1 text-right font-normal">Value</th></tr></thead>
            <tbody>
              @for (i of f.b2b; track i.number) {
                <tr class="border-t border-line"><td class="py-1 pr-3">{{ i.number }}</td><td class="py-1 pr-3">{{ i.buyer }}</td><td class="py-1 pr-3">{{ i.ctin }}</td><td class="py-1 pr-3">{{ i.pos }}</td><td class="py-1 text-right">{{ i.value | number: '1.2-2' }}</td></tr>
              } @empty { <tr><td colspan="5" class="py-3 text-center text-ink-soft">No bill to a customer with a GSTIN this month.</td></tr> }
            </tbody>
          </table>
        </div>
        @if (f.cdnr.length) {
          <h3 class="mt-4 text-sm font-medium">Credit notes to businesses</h3>
          <div class="overflow-x-auto">
            <table class="mt-1 w-full min-w-136 text-left text-xs">
              <tbody>
                @for (c of f.cdnr; track c.number) {
                  <tr class="border-t border-line"><td class="py-1 pr-3">{{ c.number }}</td><td class="py-1 pr-3">{{ c.buyer }}</td><td class="py-1 pr-3">for {{ c.invoice }}</td><td class="py-1 text-right">{{ c.value | number: '1.2-2' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        }

        <h3 class="mt-4 text-sm font-medium">HSN summary</h3>
        <div class="overflow-x-auto">
          <table class="mt-1 w-full min-w-136 text-left text-xs">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1 pr-3 font-normal">HSN</th><th class="py-1 pr-3 font-normal">Rate</th><th class="py-1 pr-3 text-right font-normal">Units</th><th class="py-1 pr-3 text-right font-normal">Value</th><th class="py-1 text-right font-normal">Taxable</th></tr></thead>
            <tbody>
              @for (h of f.hsn; track h.hsn + h.rate) {
                <tr class="border-t border-line"><td class="py-1 pr-3">{{ h.hsn || 'missing' }}</td><td class="py-1 pr-3">{{ h.rate }}%</td><td class="py-1 pr-3 text-right">{{ h.qty }}</td><td class="py-1 pr-3 text-right">{{ h.value | number: '1.2-2' }}</td><td class="py-1 text-right">{{ h.taxable | number: '1.2-2' }}</td></tr>
              } @empty { <tr><td colspan="5" class="py-3 text-center text-ink-soft">Nothing this month.</td></tr> }
            </tbody>
          </table>
        </div>

        <h3 class="mt-4 text-sm font-medium">Documents issued</h3>
        <ul class="mt-1 text-xs">
          @for (d of f.docs; track d.name) { <li class="border-t border-line py-1">{{ d.name }}: {{ d.from }} to {{ d.to }}, {{ d.total }} issued, {{ d.cancelled }} cancelled</li> }
        </ul>

        <p class="mt-4 text-[11px] text-ink-soft">Tables as CSV, for Excel or your accountant:</p>
        <div class="mt-1 flex flex-wrap gap-2">
          @for (t of tables; track t.id) { <button type="button" class="btn btn-ghost !py-1" [disabled]="busy()" (click)="get('gstr1/csv/' + t.id, 'csv', t.id)">{{ t.label }}</button> }
        </div>
      </section>
    }

    @if (r3(); as t) {
      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-base font-medium">GSTR-3B: the summary</h2>
            <p class="text-[11px] text-ink-soft">Tax on what you sold, less the tax you paid on purchases (input tax credit).</p>
          </div>
          <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="get('gstr3b/json', 'json')">Download JSON for the portal</button>
        </div>
        @for (w of t.warnings; track w) { @if (!f1Has(w)) { <p class="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{{ w }}</p> } }
        <div class="overflow-x-auto">
          <table class="mt-3 w-full min-w-120 text-left text-xs">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1 pr-3 font-normal"></th><th class="py-1 pr-3 text-right font-normal">IGST</th><th class="py-1 pr-3 text-right font-normal">CGST</th><th class="py-1 text-right font-normal">SGST</th></tr></thead>
            <tbody>
              <tr class="border-t border-line"><td class="py-1.5 pr-3">3.1 Tax on outward supplies (taxable ₹{{ t.outward.taxable | number: '1.2-2' }})</td><td class="py-1.5 pr-3 text-right">{{ t.outward.igst | number: '1.2-2' }}</td><td class="py-1.5 pr-3 text-right">{{ t.outward.cgst | number: '1.2-2' }}</td><td class="py-1.5 text-right">{{ t.outward.sgst | number: '1.2-2' }}</td></tr>
              <tr class="border-t border-line"><td class="py-1.5 pr-3">4 Input tax credit on purchases</td><td class="py-1.5 pr-3 text-right">{{ t.itc.igst | number: '1.2-2' }}</td><td class="py-1.5 pr-3 text-right">{{ t.itc.cgst | number: '1.2-2' }}</td><td class="py-1.5 text-right">{{ t.itc.sgst | number: '1.2-2' }}</td></tr>
              <tr class="border-t border-line font-medium"><td class="py-1.5 pr-3">Tax minus credit</td><td class="py-1.5 pr-3 text-right">{{ t.net.igst | number: '1.2-2' }}</td><td class="py-1.5 pr-3 text-right">{{ t.net.cgst | number: '1.2-2' }}</td><td class="py-1.5 text-right">{{ t.net.sgst | number: '1.2-2' }}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-[11px] text-ink-soft">Nil-rated sales (0% GST): ₹{{ t.nilTaxable | number: '1.2-2' }}. A minus figure is credit left over. The final set-off (IGST credit first, then CGST and SGST) is done on the portal. Purchases are counted by invoice date; purchases from suppliers without a GSTIN carry no credit. Not included: reverse charge, imports, credit you carry forward, interest and late fee.</p>
      </section>
    }

    @if (ei(); as e) {
      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-base font-medium">E-invoice</h2>
            <p class="text-[11px] text-ink-soft">Only bills to a business with a GSTIN need one, and only when your yearly turnover is above the government's limit (check the current limit with your accountant). Bills to ordinary customers never need it.</p>
          </div>
          <button type="button" class="btn btn-primary" [disabled]="busy() || !e.ready" (click)="get('einvoice/month', 'json', 'einvoice')">Download {{ e.ready }} e-invoice{{ e.ready === 1 ? '' : 's' }} (JSON)</button>
        </div>
        <p class="mt-2 text-xs">{{ e.total }} business bill{{ e.total === 1 ? '' : 's' }} this month, {{ e.ready }} ready.</p>
        @for (x of e.failed; track x.number) { <p class="mt-1 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{{ x.problem }}</p> }
        <p class="mt-2 text-[11px] text-ink-soft">The file follows the e-invoice format (version 1.1). Upload it on the e-invoice portal (IRP) to get the IRN and QR code for each bill. Orvia does not connect to the portal itself, so the IRN is not printed on the bill. A single bill's file is on the bill's own page.</p>
      </section>
    }
    @if (loading()) { <p class="mt-3 text-xs text-ink-soft">Loading…</p> }
  `,
})
export class GstFiling {
  private readonly http = inject(HttpClient);
  protected readonly ctx = inject(OutletContext);
  protected readonly month = signal(thisMonth());
  protected readonly r1 = signal<Gstr1 | null>(null);
  protected readonly r3 = signal<Gstr3b | null>(null);
  protected readonly ei = signal<EinvoiceStatus | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  private seq = 0;

  protected readonly tables = [
    { id: 'b2b', label: 'B2B invoices' },
    { id: 'b2cs', label: 'B2C summary' },
    { id: 'cdnr', label: 'Credit notes' },
    { id: 'nil', label: 'Nil rated' },
    { id: 'hsn', label: 'HSN summary' },
    { id: 'docs', label: 'Documents issued' },
  ];

  constructor() {
    // load once, and again whenever the outlet in the top bar changes
    effect(() => {
      this.ctx.selected();
      untracked(() => this.load());
    });
  }

  private params() {
    let p = new HttpParams().set('month', this.month());
    if (this.ctx.selected()) p = p.set('branchId', this.ctx.selected());
    return p;
  }

  protected f1Has(w: string) {
    return this.r1()?.warnings.includes(w) ?? false;
  }

  protected load() {
    const mine = ++this.seq;
    if (!/^\d{4}-\d{2}$/.test(this.month())) return;
    this.loading.set(true);
    this.error.set(null);
    this.notice.set(null);
    const base = `${environment.apiUrl}/gst`;
    const fail = (e: unknown) => {
      if (mine !== this.seq) return;
      this.error.set(apiError(e));
      this.loading.set(false);
      this.r1.set(null);
      this.r3.set(null);
      this.ei.set(null);
    };
    this.http.get<Gstr1>(`${base}/gstr1`, { params: this.params() }).subscribe({
      next: (d) => {
        if (mine !== this.seq) return;
        this.r1.set(d);
        this.http.get<Gstr3b>(`${base}/gstr3b`, { params: this.params() }).subscribe({
          next: (t) => {
            if (mine !== this.seq) return;
            this.r3.set(t);
            this.http.get<EinvoiceStatus>(`${base}/einvoice`, { params: this.params() }).subscribe({
              next: (x) => {
                if (mine !== this.seq) return;
                this.ei.set(x);
                this.loading.set(false);
              },
              error: fail,
            });
          },
          error: fail,
        });
      },
      error: fail,
    });
  }

  /** Downloads a file the server builds (the sign-in header is added by the app, so a plain link would not work). */
  protected get(path: string, kind: 'json' | 'csv', name = '') {
    this.busy.set(true);
    this.error.set(null);
    this.http.get(`${environment.apiUrl}/gst/${path}`, { params: this.params(), responseType: 'blob' }).subscribe({
      next: (blob) => {
        const file = kind === 'csv' ? `GSTR1_${name}_${this.month()}.csv` : `${path.split('/')[0]}_${this.month()}.json`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file;
        a.click();
        URL.revokeObjectURL(a.href);
        this.busy.set(false);
        this.notice.set(`Downloaded ${file}. Check the figures before you upload them.`);
      },
      error: async (e: HttpErrorResponse) => {
        this.busy.set(false);
        // an error comes back as a file too, so read the message out of it
        let message = 'The file could not be made.';
        try {
          message = JSON.parse(await (e.error as Blob).text()).message ?? message;
        } catch {
          /* keep the general message */
        }
        this.error.set(message);
      },
    });
  }
}
