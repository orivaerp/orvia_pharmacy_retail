import { Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { ImportPeople } from './import-people';
import { ImportStock } from './import-stock';

/** One page for bringing a shop's existing data in: medicines and stock, customers, suppliers. */
@Component({
  selector: 'app-import-hub',
  imports: [ImportStock, ImportPeople],
  template: `
    <div class="flex flex-wrap items-center gap-1 text-xs" role="tablist" aria-label="What to import">
      @for (t of tabs(); track t.id) {
        <button type="button" role="tab" class="rounded-full border border-line px-3 py-1.5" [attr.aria-selected]="tab() === t.id" [class]="tab() === t.id ? 'bg-brand text-brand-ink' : ''" (click)="tab.set(t.id)">{{ t.label }}</button>
      }
    </div>
    @switch (tab()) {
      @case ('stock') { <app-import-stock /> }
      @case ('customers') {
        <h1 class="mt-3 text-xl font-medium tracking-tight sm:text-2xl">Import customers</h1>
        <p class="mt-0.5 text-xs text-ink-soft">Bring in your customer list and what each one owes you (udhaar). Nothing is saved until you press Import.</p>
        <app-import-people kind="customers" />
      }
      @case ('suppliers') {
        <h1 class="mt-3 text-xl font-medium tracking-tight sm:text-2xl">Import suppliers</h1>
        <p class="mt-0.5 text-xs text-ink-soft">Bring in your suppliers and what you owe each one. Nothing is saved until you press Import.</p>
        <app-import-people kind="suppliers" />
      }
    }
  `,
})
export class ImportHub {
  private readonly auth = inject(AuthService);
  protected readonly tab = signal<'stock' | 'customers' | 'suppliers'>('stock');
  /** customers and suppliers carry money (opening balances), so they are for the owner and managers */
  protected readonly tabs = computed(() => {
    const money = this.auth.hasPermission('purchase.approve');
    return [
      { id: 'stock' as const, label: 'Medicines and stock' },
      ...(money && this.auth.hasPermission('sales.create') ? [{ id: 'customers' as const, label: 'Customers' }] : []),
      ...(money && this.auth.hasPermission('purchase.create') ? [{ id: 'suppliers' as const, label: 'Suppliers' }] : []),
    ];
  });
}
