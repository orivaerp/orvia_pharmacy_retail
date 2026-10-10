import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';
import { BatchRow, RetailApi } from '../retail-api.service';

export const REASONS: { id: string; label: string; dir: 'out' | 'in' | 'both' }[] = [
  { id: 'BREAKAGE', label: 'Breakage', dir: 'out' },
  { id: 'EXPIRED', label: 'Expired (write-off)', dir: 'out' },
  { id: 'DAMAGED', label: 'Damaged', dir: 'out' },
  { id: 'LOSS', label: 'Lost or stolen', dir: 'out' },
  { id: 'FOUND', label: 'Found / extra stock', dir: 'in' },
  { id: 'COUNT_CORRECTION', label: 'Stock count correction', dir: 'both' },
  { id: 'OTHER', label: 'Other (explain below)', dir: 'both' },
];

/** Adjust (write off / correct) or transfer ONE batch. Packs are always whole packs. */
@Component({
  selector: 'app-batch-action-dialog',
  template: `
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="closed.emit()">
      <div class="w-full max-w-md rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <h2 class="text-lg font-medium">{{ mode() === 'adjust' ? 'Adjust stock' : 'Transfer to another outlet' }}</h2>
        <p class="mt-0.5 text-xs text-ink-soft">
          <b class="text-ink">{{ product() }}</b> · batch {{ batch().batchNo }} · {{ batch().branchId?.name }} ·
          now <b class="text-ink">{{ batch().packs }}</b> pack{{ batch().packs === 1 ? '' : 's' }}{{ batch().loose ? ' + ' + batch().loose + ' loose' : '' }}
        </p>

        @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

        @if (mode() === 'adjust') {
          <div class="mt-3 flex gap-1 rounded-full border border-line p-1 text-xs" role="radiogroup" aria-label="Direction">
            <button type="button" role="radio" class="flex-1 rounded-full px-3 py-1" [attr.aria-checked]="dir() === 'out'" [class]="dir() === 'out' ? 'bg-brand text-brand-ink' : ''" (click)="setDir('out')">Remove stock</button>
            <button type="button" role="radio" class="flex-1 rounded-full px-3 py-1" [attr.aria-checked]="dir() === 'in'" [class]="dir() === 'in' ? 'bg-brand text-brand-ink' : ''" (click)="setDir('in')">Add stock</button>
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label class="label" for="a-packs">Packs to {{ dir() === 'out' ? 'remove' : 'add' }} *</label>
              <input id="a-packs" type="number" min="1" step="1" class="field" [value]="packs()" (input)="packs.set(+$any($event.target).value)" />
            </div>
            <div>
              <label class="label" for="a-reason">Reason *</label>
              <select id="a-reason" class="field" (change)="reason.set($any($event.target).value)">
                @for (r of reasons(); track r.id) { <option [value]="r.id" [selected]="r.id === reason()">{{ r.label }}</option> }
              </select>
            </div>
          </div>
          @if (dir() === 'out' && packs() > 0) {
            <p class="mt-2 text-[11px] text-ink-soft">After this: {{ remaining() }} pack{{ remaining() === 1 ? '' : 's' }} left.</p>
          }
        } @else {
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label class="label" for="t-to">To outlet *</label>
              <select id="t-to" class="field" (change)="to.set($any($event.target).value)">
                <option value="">Choose…</option>
                @for (o of destinations(); track o._id) { <option [value]="o._id">{{ o.name }}</option> }
              </select>
            </div>
            <div>
              <label class="label" for="t-packs">Packs to move *</label>
              <input id="t-packs" type="number" min="1" step="1" class="field" [value]="packs()" (input)="packs.set(+$any($event.target).value)" />
            </div>
          </div>
          <p class="mt-2 text-[11px] text-ink-soft">The same batch (number, expiry and MRP) is created in the other outlet. Expired batches cannot be moved; write them off instead.</p>
        }

        <div class="mt-3">
          <label class="label" for="a-note">Note {{ mode() === 'adjust' && reason() === 'OTHER' ? '*' : '(optional)' }}</label>
          <input id="a-note" class="field" [value]="note()" (input)="note.set($any($event.target).value)" [placeholder]="mode() === 'adjust' ? 'e.g. carton dropped at the counter' : 'e.g. weekly refill'" />
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="btn btn-ghost" (click)="closed.emit()">Cancel</button>
          <button type="button" class="btn" [class]="mode() === 'adjust' && dir() === 'out' ? 'btn-danger' : 'btn-primary'" [disabled]="busy()" (click)="submit()">
            {{ busy() ? 'Saving…' : mode() === 'adjust' ? (dir() === 'out' ? 'Confirm write-off' : 'Confirm addition') : 'Transfer' }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class BatchActionDialog implements OnInit {
  private readonly api = inject(RetailApi);
  private readonly ctx = inject(OutletContext);

  mode = input.required<'adjust' | 'transfer'>();
  batch = input.required<BatchRow>();
  product = input.required<string>();
  closed = output();
  done = output<string>();

  protected readonly dir = signal<'out' | 'in'>('out');
  protected readonly reason = signal('BREAKAGE');
  protected readonly packs = signal(1);
  protected readonly note = signal('');
  protected readonly to = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly reasons = computed(() => REASONS.filter((r) => r.dir === 'both' || r.dir === this.dir()));
  protected readonly destinations = computed(() => this.ctx.choices().filter((o) => o._id !== this.batch().branchId?._id));
  protected readonly remaining = computed(() => this.batch().packs - this.packs());

  ngOnInit() {
    this.ctx.load();
  }

  protected setDir(d: 'out' | 'in') {
    this.dir.set(d);
    if (!this.reasons().some((r) => r.id === this.reason())) this.reason.set(this.reasons()[0].id);
  }

  protected submit() {
    const b = this.batch();
    const packs = Math.floor(Number(this.packs()));
    if (!packs || packs < 1) return this.error.set('Enter a whole number of packs, 1 or more.');
    const branchId = b.branchId?._id;
    if (!branchId) return this.error.set('This batch has no outlet.');
    this.busy.set(true);
    this.error.set(null);
    const failed = (e: unknown) => {
      this.busy.set(false);
      this.error.set(apiError(e));
    };

    if (this.mode() === 'adjust') {
      if (this.reason() === 'OTHER' && !this.note().trim()) {
        this.busy.set(false);
        return this.error.set('Please explain the reason in the note.');
      }
      const signed = this.dir() === 'out' ? -packs : packs;
      this.api.adjustStock({ branchId, reason: this.reason(), note: this.note().trim() || undefined, lines: [{ batchId: b._id, packs: signed }] }).subscribe({
        next: (r) => this.done.emit(`Batch ${b.batchNo} adjusted by ${signed > 0 ? '+' : ''}${signed} pack${Math.abs(signed) === 1 ? '' : 's'} in ${r.branch.name}.`),
        error: failed,
      });
      return;
    }

    if (!this.to()) {
      this.busy.set(false);
      return this.error.set('Choose the outlet to send it to.');
    }
    this.api.transferStock({ fromBranchId: branchId, toBranchId: this.to(), note: this.note().trim() || undefined, lines: [{ batchId: b._id, packs }] }).subscribe({
      next: (r) => this.done.emit(`${packs} pack${packs === 1 ? '' : 's'} of batch ${b.batchNo} moved from ${r.from} to ${r.to}.`),
      error: failed,
    });
  }
}
