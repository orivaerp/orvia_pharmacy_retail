import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { RetailApi } from '../retail-api.service';
import { OutletContext } from '../outlet-context.service';
import { HeldBill, PAY_MODES, PayMode, Prescriber, SaleBatch, SaleItem, SalesApi } from './sales-api.service';
import { CustomerPick, CustomersApi } from '../customers/customers-api.service';
import { sendBillOnWhatsApp } from './whatsapp-bill';
import { Paper, printReceipt, savePaper, savedPaper } from './receipt';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(ev: string, fn: (r: { error?: { description?: string } }) => void): void };
  }
}

/** Loads Razorpay Checkout once, on first use. */
let checkoutScript: Promise<void> | null = null;
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  checkoutScript ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://checkout.razorpay.com/v1/checkout.js';
    el.onload = () => resolve();
    el.onerror = () => {
      checkoutScript = null;
      reject(new Error('Could not load the payment window. Check the internet connection.'));
    };
    document.head.appendChild(el);
  });
  return checkoutScript;
}

interface CartLine {
  item: SaleItem;
  packs: number;
  loose: number;
  discountPct: number;
  batchId: string; // '' = earliest expiry first
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The counter screen: scan or search, build the bill, take payment, print. */
@Component({
  selector: 'app-pos',
  imports: [CurrencyPipe, DatePipe, FormsModule, RouterLink],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">New sale</h1>
        <p class="mt-0.5 text-xs text-ink-soft">{{ outletName() ? 'Billing from ' + outletName() : 'Choose an outlet in the top bar to start billing.' }}</p>
      </div>
      <a routerLink="/retail/sales" class="btn btn-ghost">Bills</a>
    </div>

    @if (done(); as d) {
      <section class="card mt-3 text-center" role="status">
        <p class="text-lg font-medium">Bill {{ d.number }} saved</p>
        <p class="mt-0.5 text-sm">{{ d.grand | currency: 'INR' : 'symbol' : '1.0-0' }}</p>
        <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
          <select class="field w-auto !py-1" aria-label="Paper size" [ngModel]="paper()" (ngModelChange)="setPaper($event)">
            <option value="a4">A4 bill</option>
            <option value="thermal">80mm receipt</option>
          </select>
          <button type="button" class="btn btn-primary" (click)="print(d.id)">Print bill</button>
          <button type="button" class="btn btn-ghost" (click)="whatsapp(d.id)">Send on WhatsApp</button>
          <a [routerLink]="['/retail/sales', d.id]" class="btn btn-ghost">View bill</a>
          <button type="button" class="btn btn-ghost" (click)="done.set(null); focusSearch()">New sale</button>
        </div>
        @if (printError()) { <p class="mt-2 text-xs text-red-700">{{ printError() }}</p> }
      </section>
    } @else if (outletId()) {
      @if (holds().length) {
        <section class="card mt-3" aria-label="Bills on hold">
          <h2 class="text-sm font-medium">On hold ({{ holds().length }})</h2>
          <ul class="mt-1 divide-y divide-line text-xs">
            @for (h of holds(); track h._id) {
              <li class="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span class="min-w-0">
                  <b>{{ h.label || h.customerName || 'Unnamed bill' }}</b>
                  <span class="text-ink-soft"> · {{ h.lines.length }} item{{ h.lines.length === 1 ? '' : 's' }} · {{ h.createdAt | date: 'HH:mm' }}{{ h.heldByName ? ' · ' + h.heldByName : '' }}</span>
                </span>
                <span class="flex gap-1">
                  <button type="button" class="btn btn-primary !px-3 !py-0.5" [disabled]="resuming()" (click)="resume(h)">Resume</button>
                  <button type="button" class="btn btn-ghost !px-3 !py-0.5" (click)="discardHold(h)">Discard</button>
                </span>
              </li>
            }
          </ul>
        </section>
      }
      <div class="mt-3 grid gap-3 pb-20 lg:grid-cols-[1fr_20rem] lg:pb-0">
        <div class="min-w-0">
          <section class="card">
            <label class="label" for="pos-q">Scan barcode or search medicine</label>
            <input #search id="pos-q" class="field !min-h-11 text-base sm:text-sm" autocomplete="off" placeholder="Barcode, name or composition…" [ngModel]="q()" (ngModelChange)="onType($event)" (keydown.enter)="enter()" />
            @if (unknownCode(); as code) {
              <p role="status" class="mt-2 rounded-xl bg-tone-lavender px-3 py-2 text-xs">
                Barcode <b>{{ code }}</b> is not known yet.
                @if (canTeach()) { Search the medicine by name and tap it: Orvia remembers this barcode for your shop, so the next scan finds it straight away. }
                @else { Search the medicine by name. Ask the owner or a manager to link this barcode so it scans next time. }
              </p>
            }
            @if (taught()) { <p role="status" class="mt-2 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ taught() }}</p> }
            @if (q().trim()) {
              <ul class="mt-2 max-h-64 divide-y divide-line overflow-auto rounded-xl border border-line text-xs">
                @for (it of results(); track it.productId) {
                  <li>
                    <button type="button" class="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/60" (click)="add(it)">
                      <span class="min-w-0">
                        <span class="block truncate font-medium">{{ it.name }}</span>
                        <span class="block truncate text-[11px] text-ink-soft">{{ it.manufacturer }}{{ it.schedule !== 'OTC' ? ' · Schedule ' + it.schedule : '' }} · {{ packsOf(it) }} in stock</span>
                      </span>
                      <span class="shrink-0 font-medium">{{ it.mrp | currency: 'INR' : 'symbol' : '1.2-2' }}</span>
                    </button>
                  </li>
                } @empty {
                  <li class="px-3 py-3 text-ink-soft">{{ searching() ? 'Searching…' : 'Nothing in stock matches “' + q() + '”.' }}</li>
                }
              </ul>
            }
          </section>

          <section class="card mt-3">
            <ul class="divide-y divide-line md:hidden" aria-label="Items on the bill">
              @for (l of cart(); track l.item.productId; let i = $index) {
                <li class="py-3 text-sm">
                  <div class="flex items-start justify-between gap-2">
                    <span class="min-w-0 font-medium">{{ l.item.name }}
                      @if (l.item.schedule === 'H' || l.item.schedule === 'H1') { <span class="badge bg-tone-rose ml-1">Sch {{ l.item.schedule }}</span> }
                    </span>
                    <button type="button" class="btn btn-ghost !min-h-10 !px-3" (click)="remove(i)" [attr.aria-label]="'Remove ' + l.item.name">Remove</button>
                  </div>
                  <select class="field mt-2 !min-h-11 text-base" [ngModel]="l.batchId" (ngModelChange)="patch(i, { batchId: $event })" [attr.aria-label]="'Batch for ' + l.item.name">
                    <option value="">Earliest expiry</option>
                    @for (b of l.item.batches; track b._id) { <option [value]="b._id">{{ b.batchNo }} · {{ b.expiryDate | date: 'MM/yy' : 'UTC' }} · {{ b.mrp }}</option> }
                  </select>
                  <div class="mt-2 grid grid-cols-3 gap-2">
                    <div><label class="label">Packs</label><input type="number" inputmode="numeric" min="0" step="1" class="field !min-h-11 text-base" [ngModel]="l.packs" (ngModelChange)="patch(i, { packs: num($event) })" [attr.aria-label]="'Packs of ' + l.item.name" /></div>
                    <div><label class="label">Loose</label>@if (l.item.looseSelling) { <input type="number" inputmode="numeric" min="0" step="1" class="field !min-h-11 text-base" [ngModel]="l.loose" (ngModelChange)="patch(i, { loose: num($event) })" [attr.aria-label]="'Loose units of ' + l.item.name" /> } @else { <p class="pt-2 text-ink-soft">-</p> }</div>
                    <div><label class="label">Disc %</label><input type="number" inputmode="decimal" min="0" max="100" step="0.5" class="field !min-h-11 text-base" [ngModel]="l.discountPct" (ngModelChange)="patch(i, { discountPct: num($event) })" [attr.aria-label]="'Discount for ' + l.item.name" /></div>
                  </div>
                  @if (estimates()[i]; as e) {
                    <p class="mt-2 text-right text-base font-medium">{{ e.total | currency: 'INR' : 'symbol' : '1.2-2' }}</p>
                    @if (e.short) { <p class="text-right text-xs text-red-700">only {{ e.available }} unit(s) in stock</p> }
                  }
                </li>
              } @empty {
                <li class="py-8 text-center text-xs text-ink-soft">The bill is empty. Scan a barcode or search above.</li>
              }
            </ul>
            <div class="hidden overflow-x-auto md:block">
              <table class="w-full min-w-136 text-left">
                <thead>
                  <tr class="text-[11px] text-ink-soft">
                    <th class="py-1.5 pr-2 font-normal">Item</th>
                    <th class="py-1.5 pr-2 font-normal">Batch</th>
                    <th class="py-1.5 pr-2 font-normal">Packs</th>
                    <th class="py-1.5 pr-2 font-normal">Loose</th>
                    <th class="py-1.5 pr-2 font-normal">Disc %</th>
                    <th class="py-1.5 pr-2 text-right font-normal">Amount</th>
                    <th class="py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (l of cart(); track l.item.productId; let i = $index) {
                    <tr class="border-t border-line text-xs">
                      <td class="py-1.5 pr-2 font-medium">{{ l.item.name }}
                        @if (l.item.schedule === 'H' || l.item.schedule === 'H1') { <span class="badge bg-tone-rose ml-1">Sch {{ l.item.schedule }}</span> }
                      </td>
                      <td class="py-1.5 pr-2">
                        <select class="field !py-1" [ngModel]="l.batchId" (ngModelChange)="patch(i, { batchId: $event })" [attr.aria-label]="'Batch for ' + l.item.name">
                          <option value="">Earliest expiry</option>
                          @for (b of l.item.batches; track b._id) { <option [value]="b._id">{{ b.batchNo }} · {{ b.expiryDate | date: 'MM/yy' : 'UTC' }} · {{ b.mrp }}</option> }
                        </select>
                      </td>
                      <td class="py-1.5 pr-2"><input type="number" min="0" step="1" class="field w-16 !py-1" [ngModel]="l.packs" (ngModelChange)="patch(i, { packs: num($event) })" [attr.aria-label]="'Packs of ' + l.item.name" /></td>
                      <td class="py-1.5 pr-2">
                        @if (l.item.looseSelling) { <input type="number" min="0" step="1" class="field w-16 !py-1" [ngModel]="l.loose" (ngModelChange)="patch(i, { loose: num($event) })" [attr.aria-label]="'Loose units of ' + l.item.name" /> } @else { <span class="text-ink-soft">-</span> }
                      </td>
                      <td class="py-1.5 pr-2"><input type="number" min="0" max="100" step="0.5" class="field w-16 !py-1" [ngModel]="l.discountPct" (ngModelChange)="patch(i, { discountPct: num($event) })" [attr.aria-label]="'Discount for ' + l.item.name" /></td>
                      <td class="py-1.5 pr-2 text-right font-medium">
                        @if (estimates()[i]; as e) {
                          {{ e.total | currency: 'INR' : 'symbol' : '1.2-2' }}
                          @if (e.short) { <div class="text-[11px] font-normal text-red-700">only {{ e.available }} unit(s) in stock</div> }
                        }
                      </td>
                      <td class="py-1.5 text-right"><button type="button" class="btn btn-ghost !px-2.5 !py-0.5" (click)="remove(i)" [attr.aria-label]="'Remove ' + l.item.name">Remove</button></td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="py-8 text-center text-xs text-ink-soft">The bill is empty. Scan a barcode or search above.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          @if (needsRx()) {
            <section class="card mt-3">
              <h2 class="text-sm font-medium">Prescription details</h2>
              <p class="text-[11px] text-ink-soft">Needed by law for Schedule {{ needsH1() ? 'H and H1' : 'H' }} medicines. These are printed on the bill and kept with it.</p>
              <div class="mt-2 grid gap-3 sm:grid-cols-2">
                <div><label class="label" for="rx-d">Doctor name *</label><input id="rx-d" class="field" [class.border-red-500]="rxTried() && !rx().doctorName?.trim()" [ngModel]="rx().doctorName" (ngModelChange)="setRx({ doctorName: $event })" /></div>
                <div><label class="label" for="rx-r">Doctor registration no. {{ needsH1() ? '*' : '' }}</label><input id="rx-r" class="field" [class.border-red-500]="rxTried() && needsH1() && !rx().regNo?.trim()" [ngModel]="rx().regNo" (ngModelChange)="setRx({ regNo: $event })" /></div>
                <div><label class="label" for="rx-p">Patient name *</label><input id="rx-p" class="field" [class.border-red-500]="rxTried() && !rx().patientName?.trim()" [ngModel]="rx().patientName" (ngModelChange)="setRx({ patientName: $event })" /></div>
                <div><label class="label" for="rx-a">Patient age</label><input id="rx-a" type="number" min="0" class="field" [ngModel]="rx().patientAge" (ngModelChange)="setRx({ patientAge: num($event) || undefined })" /></div>
              </div>
            </section>
          }
        </div>

        <aside class="card h-fit lg:sticky lg:top-3">
          <h2 class="text-sm font-medium">Payment</h2>
          <dl class="mt-2 space-y-1 text-xs">
            <div class="flex justify-between"><dt class="text-ink-soft">Items total</dt><dd>{{ totals().gross | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-soft">Discount</dt><dd>-{{ totals().discount | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-soft">GST included</dt><dd>{{ totals().gst | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
            <div class="flex justify-between border-t border-line pt-1.5 text-base font-medium"><dt>To pay</dt><dd>{{ totals().grand | currency: 'INR' : 'symbol' : '1.0-0' }}</dd></div>
          </dl>

          <div class="mt-3 grid grid-cols-2 gap-1 text-xs" role="radiogroup" aria-label="Payment mode">
            @for (m of modes; track m.id) {
              <button type="button" role="radio" class="min-h-10 rounded-full border border-line px-3 py-1" [attr.aria-checked]="!split() && mode() === m.id" [class]="!split() && mode() === m.id ? 'bg-brand text-brand-ink' : ''" (click)="mode.set(m.id); split.set(false)">{{ m.label }}</button>
            }
          </div>
          <label class="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" [ngModel]="split()" (ngModelChange)="startSplit($event)" /> Split payment</label>
          @if (split()) {
            <div class="mt-2 grid grid-cols-2 gap-2">
              @for (m of modes; track m.id) {
                <div><label class="label" [for]="'pay-' + m.id">{{ m.label }}</label><input [id]="'pay-' + m.id" type="number" min="0" class="field !py-1" [ngModel]="amounts()[m.id]" (ngModelChange)="setAmount(m.id, $event)" /></div>
              }
            </div>
            <p class="mt-1 text-[11px]" [class]="splitDiff() === 0 ? 'text-ink-soft' : 'text-red-700'">{{ splitDiff() === 0 ? 'Payments match the bill.' : (splitDiff() > 0 ? splitDiff() + ' still to collect' : -splitDiff() + ' too much') }}</p>
          }

          @if (upiEnabled() && upiAmount() > 0) {
            <div class="mt-3 rounded-xl border border-line p-2 text-xs">
              @if (upiPaid(); as u) {
                <p [class]="upiMismatch() ? 'text-red-700' : ''">
                  <b>UPI ₹{{ u.amount }} received online</b> (ref {{ u.paymentId }}).
                  {{ upiMismatch() ? 'The UPI amount on this bill is now different. Put it back to ₹' + u.amount + ' or refund this payment from Razorpay.' : 'Save the bill to finish.' }}
                </p>
              } @else {
                <button type="button" class="btn btn-primary w-full" [disabled]="qrBusy() || collecting() || saving()" (click)="showQr()">{{ qrBusy() ? 'Making the QR…' : 'Show QR for ₹' + upiAmount() }}</button>
                <button type="button" class="mt-1 w-full text-center text-[11px] underline" [disabled]="collecting() || saving()" (click)="collectUpi()">{{ collecting() ? 'Opening…' : 'Other ways to pay (UPI app or UPI ID)' }}</button>
                <p class="mt-1 text-[11px] text-ink-soft">Or save directly if the customer already paid on your own QR.</p>
              }
            </div>
          }

          <div class="mt-3 grid gap-2">
            <div class="relative">
              <label class="label" for="c-find">Find customer</label>
              <input id="c-find" class="field !py-1" placeholder="Name or phone…" autocomplete="off" [ngModel]="custQ()" (ngModelChange)="findCustomer($event)" />
              @if (custResults().length) {
                <ul class="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface-solid text-xs shadow-lg">
                  @for (c of custResults(); track c._id) {
                    <li><button type="button" class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-white/60" (click)="pickCustomer(c)"><span>{{ c.name }} <span class="text-ink-soft">{{ c.phone }}</span></span><span [class]="c.owes > 0 ? 'text-red-700' : 'text-ink-soft'">{{ c.owes > 0 ? 'owes ₹' + c.owes : '' }}</span></button></li>
                  }
                </ul>
              }
            </div>
            @if (customer(); as c) {
              <p class="rounded-xl bg-white/50 px-2 py-1 text-[11px]">
                <b>{{ c.name }}</b> · owes ₹{{ c.owes }}{{ c.creditLimit ? ' · limit ₹' + c.creditLimit : '' }}
                <button type="button" class="ml-1 underline" (click)="clearCustomer()">change</button>
              </p>
              @if (creditWarning(); as w) { <p class="text-[11px] text-red-700" role="alert">{{ w }}</p> }
            }
            <div><label class="label" for="c-n">Customer name {{ usesCredit() ? '*' : '' }}</label><input id="c-n" class="field !py-1" [ngModel]="customerName()" (ngModelChange)="typedName($event)" /></div>
            <div><label class="label" for="c-p">Phone</label><input id="c-p" class="field !py-1" [ngModel]="customerPhone()" (ngModelChange)="typedPhone($event)" /></div>
          </div>

          @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
          <button type="button" class="btn btn-primary mt-3 w-full" [disabled]="saving() || !cart().length" (click)="save()">{{ saving() ? 'Saving…' : 'Save bill' }}</button>
          @if (cart().length) {
            <div class="mt-2 grid grid-cols-2 gap-2">
              <button type="button" class="btn btn-ghost" [disabled]="saving()" (click)="holdBill()">Hold bill</button>
              <button type="button" class="btn btn-ghost" (click)="clear()">Clear bill</button>
            </div>
          }
        </aside>
      </div>
      <div class="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-between gap-x-3 border-t border-line bg-surface-solid px-4 py-2 lg:hidden">
        @if (error()) { <p role="alert" class="mb-1 w-full rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{{ error() }}</p> }
        <div><p class="text-[11px] text-ink-soft">{{ cart().length }} item{{ cart().length === 1 ? '' : 's' }} · To pay</p><p class="text-lg font-medium">{{ totals().grand | currency: 'INR' : 'symbol' : '1.0-0' }}</p></div>
        <button type="button" class="btn btn-primary !min-h-11 px-6" [disabled]="saving() || !cart().length" (click)="save()">{{ saving() ? 'Saving…' : 'Save bill' }}</button>
      </div>
    }

    @if (qr(); as q) {
      <div class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Scan to pay">
        <div class="w-full max-w-sm rounded-2xl bg-surface-solid p-4 text-center shadow-xl">
          <p class="text-xs text-ink-soft">Customer scans with any UPI app</p>
          <p class="text-2xl font-medium">₹{{ q.amount }}</p>
          <img [src]="q.imageUrl" alt="UPI QR code to pay ₹{{ q.amount }}" class="mx-auto mt-2 max-h-[60vh] w-auto rounded-xl border border-line" />
          <p class="mt-2 text-xs" [class]="qrLeft() > 0 ? 'text-ink-soft' : 'text-red-700'" role="status">
            {{ qrLeft() > 0 ? 'Waiting for payment… ' + qrClock() + ' left' : 'This QR has expired.' }}
          </p>
          <div class="mt-3 flex justify-center gap-2">
            @if (qrLeft() <= 0) { <button type="button" class="btn btn-primary" (click)="showQr()">New QR</button> }
            <button type="button" class="btn btn-ghost" (click)="cancelQr()">Cancel</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class Pos {
  private readonly api = inject(SalesApi);
  protected readonly ctx = inject(OutletContext);
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly modes = PAY_MODES;
  protected readonly q = signal('');
  protected readonly results = signal<SaleItem[]>([]);
  protected readonly searching = signal(false);
  protected readonly cart = signal<CartLine[]>([]);
  protected readonly mode = signal<PayMode>('CASH');
  protected readonly split = signal(false);
  protected readonly amounts = signal<Record<PayMode, number>>({ CASH: 0, UPI: 0, CARD: 0, CREDIT: 0 });
  protected readonly customerName = signal('');
  protected readonly customerPhone = signal('');
  protected readonly rx = signal<Prescriber>({});
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly printError = signal<string | null>(null);
  protected readonly done = signal<{ id: string; number: string; grand: number } | null>(null);
  protected readonly holds = signal<HeldBill[]>([]);
  private readonly customersApi = inject(CustomersApi);
  private readonly retailApi = inject(RetailApi);
  private readonly auth = inject(AuthService);
  /** a scanned code that matched nothing: the next medicine the cashier picks gets it */
  protected readonly unknownCode = signal<string | null>(null);
  protected readonly taught = signal<string | null>(null);
  protected readonly canTeach = computed(() => this.auth.hasPermission('product.manage'));
  protected readonly customer = signal<CustomerPick | null>(null);
  protected readonly custResults = signal<CustomerPick[]>([]);
  protected readonly custQ = signal('');
  private custTimer?: ReturnType<typeof setTimeout>;

  /** udhaar on this bill (the whole bill, or the "on credit" box when payment is split) would take the customer over their limit */
  protected readonly creditWarning = computed(() => {
    const c = this.customer();
    const credit = this.split() ? this.amounts().CREDIT : this.mode() === 'CREDIT' ? this.totals().grand : 0;
    if (!c || credit <= 0 || !c.creditLimit) return null;
    return c.owes + credit > c.creditLimit ? `${c.name} owes ₹${c.owes}; with this bill that is over the ₹${c.creditLimit} limit.` : null;
  });
  protected readonly upiEnabled = signal(false);
  protected readonly collecting = signal(false);
  protected readonly qr = signal<{ qrId: string; imageUrl: string; amount: number; expiresAt: number } | null>(null);
  protected readonly qrBusy = signal(false);
  protected readonly qrLeft = signal(0);
  protected readonly qrClock = computed(() => `${Math.floor(this.qrLeft() / 60)}:${String(this.qrLeft() % 60).padStart(2, '0')}`);
  private qrTimer?: ReturnType<typeof setInterval>;
  private qrTicks = 0;
  protected readonly upiPaid = signal<{ orderId: string; paymentId: string; amount: number } | null>(null);
  protected readonly resuming = signal(false);
  protected readonly rxTried = signal(false);
  protected readonly paper = signal<Paper>(savedPaper());
  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  /** the outlet being billed from: the one picked in the top bar, or the user's only outlet */
  protected readonly outletId = computed(() => {
    const picked = this.ctx.selected();
    if (picked) return picked;
    const all = this.ctx.choices();
    return all.length === 1 ? all[0]._id : '';
  });
  protected readonly outletName = computed(() => this.ctx.choices().find((o) => o._id === this.outletId())?.name ?? '');

  /** what each line will cost: batches are used in the same order the server will use them */
  protected readonly estimates = computed(() =>
    this.cart().map((l) => {
      const upp = l.item.unitsPerPack || 1;
      let need = l.packs * upp + l.loose;
      const batches: SaleBatch[] = l.batchId ? l.item.batches.filter((b) => b._id === l.batchId) : l.item.batches;
      const available = batches.reduce((s, b) => s + b.units, 0);
      let gross = 0;
      let total = 0;
      let discount = 0;
      let gst = 0;
      for (const b of batches) {
        if (need <= 0) break;
        const take = Math.min(need, b.units);
        need -= take;
        const g = r2((take * b.mrp) / upp);
        const d = r2((g * l.discountPct) / 100);
        const t = r2(g - d);
        gross += g;
        discount += d;
        total += t;
        gst += r2(t - t / (1 + l.item.gstPercent / 100));
      }
      return { gross, discount, total: r2(total), gst, short: need > 0, available };
    }),
  );

  protected readonly totals = computed(() => {
    const es = this.estimates();
    const sum = (k: 'gross' | 'discount' | 'total' | 'gst') => r2(es.reduce((s, e) => s + e[k], 0));
    return { gross: sum('gross'), discount: sum('discount'), gst: sum('gst'), grand: Math.round(sum('total')) };
  });

  protected readonly needsRx = computed(() => this.cart().some((l) => l.item.schedule === 'H' || l.item.schedule === 'H1'));
  protected readonly needsH1 = computed(() => this.cart().some((l) => l.item.schedule === 'H1'));
  protected readonly usesCredit = computed(() => (this.split() ? this.amounts().CREDIT > 0 : this.mode() === 'CREDIT'));
  protected readonly splitDiff = computed(() => r2(this.totals().grand - Object.values(this.amounts()).reduce((s, v) => s + (v || 0), 0)));

  /** the UPI part of this bill: the whole total, or the UPI box when payment is split */
  protected readonly upiAmount = computed(() => (this.split() ? this.amounts().UPI : this.mode() === 'UPI' ? this.totals().grand : 0));
  protected readonly upiMismatch = computed(() => {
    const u = this.upiPaid();
    return !!u && Math.abs(u.amount - this.upiAmount()) > 0.009;
  });

  constructor() {
    this.ctx.load();
    this.api.upiEnabled().subscribe({ next: (r) => this.upiEnabled.set(r.enabled), error: () => this.upiEnabled.set(false) });
    effect(() => {
      const outlet = this.outletId();
      untracked(() => this.loadHolds(outlet));
    });
  }

  /** Opens Razorpay Checkout for the UPI amount. The bill is only saved after the server has verified the payment. */
  protected async collectUpi() {
    this.error.set(null);
    const branchId = this.outletId();
    const amount = this.upiAmount();
    if (!branchId || amount < 1) return this.error.set('The UPI amount must be at least ₹1.');
    if (!this.cart().length) return this.error.set('Add items first.');
    this.collecting.set(true);
    try {
      await loadCheckout();
      const order = await new Promise<{ orderId: string; keyId: string; amountPaise: number }>((resolve, reject) =>
        this.api.upiOrder(branchId, amount).subscribe({ next: resolve, error: reject }),
      );
      const Checkout = window.Razorpay!;
      const rz = new Checkout({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: 'INR',
        name: this.outletName() || 'Orvia',
        description: 'Medicine bill',
        theme: { color: '#0b3d3a' },
        prefill: this.phoneDigits() ? { contact: this.phoneDigits() } : undefined,
        method: { upi: true, card: false, netbanking: false, wallet: false, emi: false, paylater: false },
        modal: { ondismiss: () => this.collecting.set(false) },
        handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          this.api.upiVerify({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }).subscribe({
            next: (v) => {
              this.collecting.set(false);
              this.upiPaid.set(v);
            },
            error: (e) => {
              this.collecting.set(false);
              this.error.set('Payment was made but could not be confirmed: ' + apiError(e) + ' Ref ' + r.razorpay_payment_id);
            },
          });
        },
      });
      rz.on('payment.failed', (r) => {
        this.collecting.set(false);
        this.error.set(r.error?.description ?? 'The payment failed. Please try again.');
      });
      rz.open();
    } catch (e) {
      this.collecting.set(false);
      this.error.set(e instanceof Error && !('status' in e) ? e.message : apiError(e));
    }
  }

  /** the customer's 10-digit mobile number, if one was typed, so Checkout does not ask for it again */
  private phoneDigits(): string {
    const d = this.customerPhone().replace(/[^0-9]/g, '').slice(-10);
    return d.length === 10 ? d : '';
  }

  /** Puts a payment QR on screen and watches for the money. The bill is saved afterwards, as with Checkout. */
  protected showQr() {
    this.error.set(null);
    const branchId = this.outletId();
    const amount = this.upiAmount();
    if (!branchId || amount < 1) return this.error.set('The UPI amount must be at least ₹1.');
    if (!this.cart().length) return this.error.set('Add items first.');
    const old = this.qr();
    if (old) this.api.upiQrClose(old.qrId).subscribe({ error: () => undefined });
    this.stopQrTimer();
    this.qrBusy.set(true);
    this.api.upiQr(branchId, amount).subscribe({
      next: (r) => {
        this.qrBusy.set(false);
        this.qr.set({ qrId: r.qrId, imageUrl: r.imageUrl, amount: r.amount, expiresAt: new Date(r.expiresAt).getTime() });
        this.qrTicks = 0;
        this.tickQr();
        this.qrTimer = setInterval(() => this.tickQr(), 1000);
      },
      error: (e) => {
        this.qrBusy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  private tickQr() {
    const q = this.qr();
    if (!q) return this.stopQrTimer();
    this.qrLeft.set(Math.max(0, Math.round((q.expiresAt - Date.now()) / 1000)));
    if (this.qrLeft() <= 0 || ++this.qrTicks % 3 !== 0) return;
    this.api.upiQrStatus(q.qrId).subscribe({
      next: (r) => {
        if (r.status !== 'paid' || this.qr()?.qrId !== q.qrId) return;
        this.stopQrTimer();
        this.qr.set(null);
        this.upiPaid.set({ orderId: q.qrId, paymentId: r.paymentId ?? '', amount: r.amount ?? q.amount });
      },
      error: () => undefined, // a blip in the connection: the next check will try again
    });
  }

  protected cancelQr() {
    const q = this.qr();
    this.stopQrTimer();
    this.qr.set(null);
    if (q) this.api.upiQrClose(q.qrId).subscribe({ error: () => undefined });
  }

  private stopQrTimer() {
    clearInterval(this.qrTimer);
    this.qrTimer = undefined;
  }

  protected findCustomer(q: string) {
    this.custQ.set(q);
    clearTimeout(this.custTimer);
    if (q.trim().length < 2) return this.custResults.set([]);
    this.custTimer = setTimeout(() => this.customersApi.search(q.trim()).subscribe({ next: (r) => this.custResults.set(r), error: () => this.custResults.set([]) }), 250);
  }

  protected pickCustomer(c: CustomerPick) {
    this.customer.set(c);
    this.customerName.set(c.name);
    this.customerPhone.set(c.phone);
    this.custResults.set([]);
    this.custQ.set('');
  }

  protected clearCustomer() {
    this.customer.set(null);
  }

  /** editing the name or phone by hand means it is no longer the customer that was picked */
  protected typedName(v: string) {
    this.customerName.set(v);
    if (this.customer() && v !== this.customer()!.name) this.customer.set(null);
  }

  protected typedPhone(v: string) {
    this.customerPhone.set(v);
    if (this.customer() && v !== this.customer()!.phone) this.customer.set(null);
  }

  protected setPaper(p: Paper) {
    this.paper.set(p);
    savePaper(p);
  }

  private loadHolds(outlet: string) {
    if (!outlet) return this.holds.set([]);
    this.api.holds(outlet).subscribe({ next: (h) => this.holds.set(h), error: () => this.holds.set([]) });
  }

  /** Parks the current bill. No stock is taken until it is billed. */
  protected holdBill() {
    this.error.set(null);
    if (this.upiPaid()) return this.error.set('UPI money is already received for this bill. Save it instead of holding.');
    const branchId = this.outletId();
    if (!branchId || !this.cart().length) return;
    this.api
      .hold({
        branchId,
        label: this.customerName().trim() || undefined,
        customerName: this.customerName().trim() || undefined,
        customerPhone: this.customerPhone().trim() || undefined,
        prescriber: this.needsRx() ? this.rx() : undefined,
        lines: this.cart().map((l) => ({ productId: l.item.productId, name: l.item.name, batchId: l.batchId || undefined, packs: l.packs, loose: l.loose || undefined, discountPct: l.discountPct })),
      })
      .subscribe({
        next: () => {
          this.cart.set([]);
          this.rx.set({});
          this.customerName.set('');
          this.customerPhone.set('');
          this.loadHolds(branchId);
          this.focusSearch();
        },
        error: (e) => this.error.set(apiError(e)),
      });
  }

  /** Brings a held bill back, with today's stock and prices. Items no longer in stock are left out and reported. */
  protected resume(h: HeldBill) {
    const branchId = this.outletId();
    if (!branchId) return;
    if (this.cart().length && !confirm('The current bill will be replaced. Hold it first if you want to keep it. Continue?')) return;
    this.resuming.set(true);
    this.error.set(null);
    const lines: CartLine[] = [];
    const missing: string[] = [];
    let left = h.lines.length;
    const finish = () => {
      if (--left > 0) return;
      this.resuming.set(false);
      this.cart.set(lines);
      this.customerName.set(h.customerName ?? '');
      this.customerPhone.set(h.customerPhone ?? '');
      this.rx.set(h.prescriber ?? {});
      this.api.discardHold(h._id).subscribe({ next: () => this.loadHolds(branchId) });
      if (missing.length) this.error.set('Not in stock any more, left out: ' + missing.join(', '));
    };
    for (const hl of h.lines) {
      this.api.search(branchId, hl.name ?? '').subscribe({
        next: (r) => {
          const item = r.find((x) => x.productId === hl.productId);
          if (item) lines.push({ item, packs: hl.packs, loose: hl.loose ?? 0, discountPct: hl.discountPct, batchId: item.batches.some((b) => b._id === hl.batchId) ? (hl.batchId ?? '') : '' });
          else missing.push(hl.name ?? 'an item');
          finish();
        },
        error: () => {
          missing.push(hl.name ?? 'an item');
          finish();
        },
      });
    }
  }

  protected discardHold(h: HeldBill) {
    if (!confirm('Discard this held bill?')) return;
    this.api.discardHold(h._id).subscribe({ next: () => this.loadHolds(this.outletId()), error: (e) => this.error.set(apiError(e)) });
  }

  protected num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n * 100) / 100 : 0;
  }

  protected packsOf(it: SaleItem): string {
    const p = Math.floor(it.units / (it.unitsPerPack || 1));
    const l = it.units % (it.unitsPerPack || 1);
    return `${p} pack${p === 1 ? '' : 's'}${l ? ' + ' + l + ' loose' : ''}`;
  }

  protected whatsapp(id: string) {
    this.printError.set(null);
    sendBillOnWhatsApp(this.api, id, (m) => this.printError.set(m));
  }

  protected focusSearch() {
    setTimeout(() => this.searchBox()?.nativeElement.focus());
  }

  protected onType(v: string) {
    this.q.set(v);
    this.taught.set(null);
    clearTimeout(this.timer);
    if (!v.trim()) {
      this.unknownCode.set(null);
      return this.results.set([]);
    }
    this.timer = setTimeout(() => this.run(), 250);
  }

  /** Enter (a barcode scanner types the code and presses Enter) adds a barcode match straight away. */
  protected enter() {
    clearTimeout(this.timer);
    this.run(true);
  }

  private run(fromEnter = false) {
    const branchId = this.outletId();
    const text = this.q().trim();
    if (!branchId || !text) return;
    const mine = ++this.seq;
    this.searching.set(true);
    this.api.search(branchId, text).subscribe({
      next: (r) => {
        if (mine !== this.seq) return;
        this.searching.set(false);
        this.results.set(r);
        if (fromEnter && r.length && (r[0].barcodeMatch || r.length === 1)) this.add(r[0]);
        else if (fromEnter && !r.length && /^\d{8,14}$/.test(text)) {
          this.unknownCode.set(text);
          this.taught.set(null);
        }
      },
      error: (e) => {
        this.searching.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected add(it: SaleItem) {
    this.error.set(null);
    const code = this.unknownCode();
    if (code) {
      this.unknownCode.set(null);
      if (this.canTeach()) {
        this.retailApi.saveBarcode(it.productId, code).subscribe({
          next: () => this.taught.set(`Barcode ${code} saved on ${it.name}. Scan it next time.`),
          error: (e) => this.taught.set(apiError(e)),
        });
      }
    }
    const at = this.cart().findIndex((l) => l.item.productId === it.productId);
    if (at >= 0) this.patch(at, { packs: this.cart()[at].packs + 1 });
    else this.cart.update((c) => [...c, { item: it, packs: 1, loose: 0, discountPct: 0, batchId: '' }]);
    this.q.set('');
    this.results.set([]);
    this.focusSearch();
  }

  protected patch(i: number, change: Partial<CartLine>) {
    this.cart.update((c) => c.map((l, k) => (k === i ? { ...l, ...change } : l)));
  }

  protected remove(i: number) {
    this.cart.update((c) => c.filter((_, k) => k !== i));
  }

  protected clear() {
    if (this.upiPaid() && !confirm('UPI money has already been received for this bill. Clearing it leaves that payment without a bill. Continue?')) return;
    this.upiPaid.set(null);
    this.cart.set([]);
    this.rx.set({});
    this.error.set(null);
  }

  protected setRx(change: Partial<Prescriber>) {
    this.rx.update((r) => ({ ...r, ...change }));
  }

  protected startSplit(on: boolean) {
    this.split.set(on);
    if (on) this.amounts.set({ CASH: this.totals().grand, UPI: 0, CARD: 0, CREDIT: 0 });
  }

  protected setAmount(m: PayMode, v: unknown) {
    this.amounts.update((a) => ({ ...a, [m]: this.num(v) }));
  }

  protected save() {
    this.error.set(null);
    const branchId = this.outletId();
    if (!branchId) return this.error.set('Choose an outlet first.');
    if (this.needsRx()) {
      this.rxTried.set(true);
      const rx = this.rx();
      if (!rx.doctorName?.trim() || !rx.patientName?.trim()) return this.error.set('Schedule H/H1 medicines: enter the doctor and patient name below the items.');
      if (this.needsH1() && !rx.regNo?.trim()) return this.error.set('Schedule H1: enter the doctor registration number.');
    }
    if (this.estimates().some((e) => e.short)) return this.error.set('Some items are more than the stock. Reduce the quantity.');
    if (this.cart().some((l) => l.packs + l.loose < 1)) return this.error.set('Every item needs a quantity of at least 1.');
    if (this.split() && this.splitDiff() !== 0) return this.error.set('Split payments must add up to the bill total.');

    const paid = this.upiPaid();
    if (paid && this.upiMismatch()) return this.error.set('The UPI amount on this bill no longer matches the ₹' + paid.amount + ' received online.');
    if (paid && this.upiAmount() === 0) return this.error.set('₹' + paid.amount + ' was received by UPI. Choose UPI for that amount, or refund the payment from Razorpay.');
    const payments = this.split()
      ? this.modes.filter((m) => this.amounts()[m.id] > 0).map((m) => ({ mode: m.id, amount: this.amounts()[m.id] }))
      : [{ mode: this.mode(), amount: this.totals().grand }];
    for (const p of payments as { mode: PayMode; amount: number; orderId?: string }[]) if (p.mode === 'UPI' && paid) p.orderId = paid.orderId;
    const rx = this.rx();
    this.saving.set(true);
    this.api
      .create({
        branchId,
        customerId: this.customer()?._id,
        customerName: this.customerName().trim() || undefined,
        customerPhone: this.customerPhone().trim() || undefined,
        prescriber: this.needsRx() ? rx : undefined,
        lines: this.cart().map((l) => ({ productId: l.item.productId, batchId: l.batchId || undefined, packs: l.packs, loose: l.loose || undefined, discountPct: l.discountPct })),
        payments,
      })
      .subscribe({
        next: (s) => {
          this.saving.set(false);
          this.done.set({ id: s._id, number: s.number, grand: s.totals.grand });
          this.rxTried.set(false);
          this.upiPaid.set(null);
          this.cart.set([]);
          this.rx.set({});
          this.customerName.set('');
          this.customerPhone.set('');
          this.customer.set(null);
          this.split.set(false);
          this.mode.set('CASH');
        },
        error: (e) => {
          this.saving.set(false);
          this.error.set(apiError(e));
        },
      });
  }

  protected print(id: string) {
    this.printError.set(null);
    this.api.get(id).subscribe({
      next: (s) => {
        if (!printReceipt(s, this.paper())) this.printError.set('The print window was blocked. Allow pop-ups for this site, or open the bill and print from there.');
      },
      error: (e) => this.printError.set(apiError(e)),
    });
  }
}
