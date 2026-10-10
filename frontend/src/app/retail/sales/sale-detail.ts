import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { Paper, printReceipt, savePaper, savedPaper } from './receipt';
import { sendBillOnWhatsApp } from './whatsapp-bill';
import { PAY_MODES, PayMode, SaleDetail, SalesApi } from './sales-api.service';

/** One bill: items, GST, payments, returns. Print it again, or take items back. */
@Component({
  selector: 'app-sale-detail',
  imports: [CurrencyPipe, DatePipe, FormsModule, RouterLink],
  template: `
    <a routerLink="/retail/sales" class="text-xs text-ink-soft hover:text-ink">&larr; Bills</a>

    @if (error()) { <p role="alert" class="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-2 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (sale(); as s) {
      <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="flex items-center gap-2 text-xl font-medium tracking-tight sm:text-2xl">
            {{ s.number }} <span class="badge" [class]="s.status === 'COMPLETED' ? 'bg-tone-lime' : 'bg-tone-rose'">{{ s.status === 'CANCELLED' ? 'cancelled' : s.status === 'RETURNED' ? 'returned' : 'completed' }}</span>
          </h1>
          <p class="mt-0.5 text-xs text-ink-soft">{{ s.createdAt | date: 'dd MMM yyyy, HH:mm' }} · {{ s.branchId?.name }} · by {{ s.soldByName || 'staff' }}</p>
        </div>
        <div class="flex items-center gap-2">
          <select class="field w-auto !py-1" aria-label="Paper size" [ngModel]="paper()" (ngModelChange)="setPaper($event)">
            <option value="a4">A4 bill</option>
            <option value="thermal">80mm receipt</option>
          </select>
          <button type="button" class="btn btn-primary" (click)="print()">Print bill</button>
          @if (canSend()) { <button type="button" class="btn btn-ghost" (click)="whatsapp()">Send on WhatsApp</button> }
        </div>
      </div>

      @if (s.shared && canReturn()) {
        <p class="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-white/50 px-3 py-2 text-xs">The customer has a link to this bill. <button type="button" class="underline" [disabled]="busy()" (click)="stopSharing()">Turn the link off</button></p>
      }
      @if (s.status === 'CANCELLED') {
        <p class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" role="status">This bill was cancelled{{ s.cancelledAt ? ' on ' + (s.cancelledAt | date: 'dd MMM yyyy, HH:mm') : '' }}{{ s.cancelledByName ? ' by ' + s.cancelledByName : '' }}. Reason: {{ s.cancelReason }}. The stock is back and the payment was refunded (see Returns). The bill number stays used.</p>
      }
      <section class="card mt-3">
        <div class="overflow-x-auto">
          <table class="w-full min-w-176 text-left">
            <thead>
              <tr class="text-[11px] text-ink-soft">
                <th class="py-1.5 pr-3 font-normal">Item</th>
                <th class="py-1.5 pr-3 font-normal">Batch</th>
                <th class="py-1.5 pr-3 font-normal">Qty (units)</th>
                <th class="py-1.5 pr-3 font-normal">MRP/pack</th>
                <th class="py-1.5 pr-3 font-normal">GST</th>
                <th class="py-1.5 pr-3 text-right font-normal">Amount</th>
                @if (canReturn()) { <th class="py-1.5 font-normal">Take back</th> }
              </tr>
            </thead>
            <tbody>
              @for (l of s.lines; track l.batchId) {
                <tr class="border-t border-line text-xs">
                  <td class="py-1.5 pr-3 font-medium">{{ l.name }}</td>
                  <td class="py-1.5 pr-3">{{ l.batchNo }} · {{ l.expiryDate | date: 'MM/yy' : 'UTC' }}</td>
                  <td class="py-1.5 pr-3">{{ l.units }}{{ l.returnedUnits ? ' (' + l.returnedUnits + ' returned)' : '' }}</td>
                  <td class="py-1.5 pr-3">{{ l.mrp | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  <td class="py-1.5 pr-3">{{ l.gstPercent }}%</td>
                  <td class="py-1.5 pr-3 text-right font-medium">{{ l.total | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  @if (canReturn()) {
                    <td class="py-1.5">
                      @if (l.units - l.returnedUnits > 0) {
                        <input type="number" min="0" [max]="l.units - l.returnedUnits" class="field w-20 !py-1" [ngModel]="back()[l.batchId] || 0" (ngModelChange)="setBack(l.batchId, $event)" [attr.aria-label]="'Units of ' + l.name + ' to take back'" />
                      } @else { <span class="text-ink-soft">all returned</span> }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>

        <dl class="ml-auto mt-3 max-w-xs space-y-1 text-xs">
          <div class="flex justify-between"><dt class="text-ink-soft">Taxable value</dt><dd>{{ s.totals.taxable | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
          <div class="flex justify-between"><dt class="text-ink-soft">GST</dt><dd>{{ s.totals.gst | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
          <div class="flex justify-between"><dt class="text-ink-soft">Discount given</dt><dd>{{ s.totals.discount | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
          <div class="flex justify-between"><dt class="text-ink-soft">Round off</dt><dd>{{ s.totals.roundOff | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
          <div class="flex justify-between border-t border-line pt-1.5 text-base font-medium"><dt>Total</dt><dd>{{ s.totals.grand | currency: 'INR' : 'symbol' : '1.0-0' }}</dd></div>
        </dl>
      </section>

      <div class="mt-3 grid gap-3 md:grid-cols-2">
        <section class="card">
          <h2 class="text-sm font-medium">Customer and payment</h2>
          <p class="mt-1 text-xs">@if (s.customerId) { <a [routerLink]="['/retail/customers', s.customerId]" class="underline">{{ s.customerName }}</a> } @else { {{ s.customerName || 'Walk-in customer' }} } {{ s.customerPhone ? '· ' + s.customerPhone : '' }}</p>
          @for (p of s.payments; track $index) { <p class="text-xs text-ink-soft">{{ p.mode }}: {{ p.amount | currency: 'INR' : 'symbol' : '1.2-2' }}</p> }
          @if (s.prescriber?.doctorName) {
            <h2 class="mt-3 text-sm font-medium">Prescription</h2>
            <p class="text-xs">Dr {{ s.prescriber!.doctorName }}{{ s.prescriber!.regNo ? ' (Reg ' + s.prescriber!.regNo + ')' : '' }} · Patient {{ s.prescriber!.patientName }}{{ s.prescriber!.patientAge ? ', ' + s.prescriber!.patientAge + ' yrs' : '' }}</p>
          }
        </section>

        <section class="card">
          <h2 class="text-sm font-medium">Returns</h2>
          @for (r of s.returns; track r._id) {
            <div class="mt-1 text-xs">
              {{ r.number }} · {{ r.createdAt | date: 'dd MMM, HH:mm' }} · refund {{ r.refund | currency: 'INR' : 'symbol' : '1.2-2' }} ({{ r.gatewayRefund?.status ? 'to customer UPI' : r.refundMode.toLowerCase() }})
              @if (r.gatewayRefund?.status; as st) {
                <span class="badge ml-1" [class]="st === 'processed' ? 'bg-tone-lime' : st === 'failed' ? 'bg-tone-rose' : 'bg-chip'">{{ refundLabel(st) }}</span>
                @if (st === 'failed') {
                  <div class="mt-0.5 text-[11px] text-red-700">{{ r.gatewayRefund?.error || 'The refund could not be sent.' }} The stock is back and the return is recorded, but the customer has not been paid back yet.</div>
                  @if (canReturn()) { <button type="button" class="btn btn-ghost mt-1 !px-2.5 !py-0.5" [disabled]="busy()" (click)="retry(r._id)">Try the UPI refund again</button> }
                }
              }
              <div class="text-ink-soft">{{ r.reason }}</div>
            </div>
          } @empty { <p class="mt-1 text-xs text-ink-soft">Nothing returned.</p> }

          @if (canReturn() && s.status === 'COMPLETED' && !s.returns.length && cancellable(s)) {
            <div class="mt-3 grid gap-2 border-t border-line pt-3">
              <h3 class="text-sm font-medium">Cancel this whole bill</h3>
              <p class="text-[11px] text-ink-soft">For a bill made by mistake. All items go back into stock and the customer is paid back the way they paid:</p>
              <ul class="list-disc pl-5 text-[11px]">@for (l of cancelPlan(s); track l) { <li>{{ l }}</li> }</ul>
              <div><label class="label" for="c-reason">Reason *</label><input id="c-reason" class="field" [ngModel]="cancelReason()" (ngModelChange)="cancelReason.set($event)" placeholder="e.g. billed to the wrong customer" /></div>
              <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="cancelBill()">Cancel bill {{ s.number }}</button>
            </div>
          }

          @if (canReturn() && s.status === 'COMPLETED') {
            <div class="mt-3 grid gap-2 border-t border-line pt-3">
              <div><label class="label" for="r-reason">Reason *</label><input id="r-reason" class="field" [ngModel]="reason()" (ngModelChange)="reason.set($event)" placeholder="e.g. wrong medicine given" /></div>
              <div>
                <label class="label" for="r-mode">Refund as</label>
                <select id="r-mode" class="field" (change)="refundMode.set($any($event.target).value)">
                  @if (s.gateway && s.gateway.remaining > 0) { <option value="GATEWAY">Back to customer's UPI via Razorpay (up to ₹{{ s.gateway.remaining }})</option> }
                  @for (m of modes; track m.id) { <option [value]="m.id">{{ m.label }}</option> }
                </select>
              </div>
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="takeBack()">Take items back and refund</button>
              <p class="text-[11px] text-ink-soft">Fill “Take back” in the table above. Returned items go back into the same batch.</p>
            </div>
          }
        </section>
      </div>
    }
  `,
})
export class SaleDetailPage {
  private readonly api = inject(SalesApi);
  protected readonly auth = inject(AuthService);

  id = input.required<string>();
  protected readonly modes = PAY_MODES;
  protected readonly sale = signal<SaleDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly back = signal<Record<string, number>>({});
  protected readonly paper = signal<Paper>(savedPaper());
  protected readonly reason = signal('');
  protected readonly cancelReason = signal('');
  protected readonly refundMode = signal<PayMode | 'GATEWAY'>('CASH');

  constructor() {
    effect(() => this.load(this.id()));
  }

  /** a bill can be cancelled for 7 days; after that, items are taken back with a return */
  protected cancellable(s: SaleDetail) {
    return Date.now() - new Date(s.createdAt).getTime() <= 7 * 86_400_000;
  }

  protected cancelPlan(s: SaleDetail): string[] {
    const rs = (n: number) => '₹' + n.toFixed(2);
    return s.payments
      .filter((p) => p.amount > 0)
      .map((p) => {
        if (p.mode === 'CASH') return `${rs(p.amount)} cash goes back from your drawer.`;
        if (p.mode === 'UPI') return s.gateway && s.gateway.remaining >= p.amount - 0.009 && s.gateway.amount === p.amount ? `${rs(p.amount)} is sent back to the customer's UPI through Razorpay.` : `${rs(p.amount)} UPI: you give it back yourself (it is recorded here).`;
        if (p.mode === 'CARD') return `${rs(p.amount)} card: you refund it yourself (it is recorded here).`;
        return `${rs(p.amount)} udhaar is taken off ${s.customerName || 'the customer'}'s balance.`;
      });
  }

  protected cancelBill() {
    const s = this.sale()!;
    const reason = this.cancelReason().trim();
    if (reason.length < 3) return this.error.set('Please give a reason for cancelling.');
    if (!confirm(['Cancel bill ' + s.number + '?', '', ...this.cancelPlan(s), '', 'This cannot be undone.'].join('\n'))) return;
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    this.api.cancel(this.id(), reason).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.cancelReason.set('');
        const failed = r.returns.find((x) => x.gatewayRefund?.status === 'failed');
        this.notice.set(failed ? `${r.number} is cancelled and the stock is back, but the UPI refund of ₹${failed.refund.toFixed(2)} could not be sent: ${failed.gatewayRefund?.error ?? 'try again under Returns'}` : `${r.number} is cancelled. The stock is back and the payment is refunded.`);
        this.load(this.id());
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected canSend() {
    return this.auth.hasPermission('sales.create');
  }

  protected whatsapp() {
    this.error.set(null);
    sendBillOnWhatsApp(this.api, this.id(), (m) => this.error.set(m), () => this.load(this.id()));
  }

  protected stopSharing() {
    if (!confirm('Turn off the link the customer has? That address will stop working.')) return;
    this.busy.set(true);
    this.api.unshare(this.id()).subscribe({
      next: () => {
        this.busy.set(false);
        this.notice.set('The link is turned off.');
        this.load(this.id());
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected canReturn() {
    return this.auth.hasPermission('purchase.approve');
  }

  private load(id: string) {
    this.api.get(id).subscribe({
      next: (s) => {
        this.sale.set(s);
        this.back.set({});
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  protected refundLabel(st: string) {
    return ({ requested: 'sending…', pending: 'on its way', processed: 'refunded to UPI', failed: 'not sent' } as Record<string, string>)[st] ?? st;
  }

  protected retry(returnId: string) {
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    this.api.retryRefund(this.id(), returnId).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.notice.set(r.gatewayRefund?.status === 'failed' ? `Still not sent: ${r.gatewayRefund.error ?? 'Razorpay refused it.'}` : 'The refund is on its way to the customer.');
        this.load(this.id());
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected setBack(batchId: string, v: unknown) {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    this.back.update((b) => ({ ...b, [batchId]: n }));
  }

  protected setPaper(p: Paper) {
    this.paper.set(p);
    savePaper(p);
  }

  protected print() {
    const s = this.sale();
    if (s && !printReceipt(s, this.paper())) this.error.set('The print window was blocked. Allow pop-ups for this site.');
  }

  protected takeBack() {
    this.error.set(null);
    this.notice.set(null);
    const lines = Object.entries(this.back())
      .filter(([, units]) => units > 0)
      .map(([batchId, units]) => ({ batchId, units }));
    if (!lines.length) return this.error.set('Enter how many units to take back.');
    if (this.reason().trim().length < 3) return this.error.set('Please give a reason.');
    this.busy.set(true);
    this.api.returnItems(this.id(), { reason: this.reason().trim(), refundMode: this.refundMode(), lines }).subscribe({
      next: (r) => {
        this.busy.set(false);
        const g = r.gatewayRefund?.status;
        this.notice.set(
          g === 'failed'
            ? `${r.number} is recorded and the stock is back, but the UPI refund of ${r.refund.toFixed(2)} could not be sent: ${r.gatewayRefund?.error ?? 'try again below'}`
            : g
              ? `${r.number}: ${r.refund.toFixed(2)} is being sent back to the customer's UPI.`
              : `${r.number}: refund ${r.refund.toFixed(2)} (${this.refundMode().toLowerCase()}).`,
        );
        this.reason.set('');
        this.load(this.id());
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
