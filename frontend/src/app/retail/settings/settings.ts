import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';

interface Shop {
  name: string;
  phone: string;
  address: string;
  gstin: string;
  drugLicenseNo: string;
  lowStockDefault: number;
}

/** The shop's own details (printed on bills and emails) and the shop-wide low-stock level. */
@Component({
  selector: 'app-shop-settings',
  imports: [FormsModule],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Settings</h1>
    <p class="mt-0.5 text-xs text-ink-soft">These details are printed on your bills and sent in customer emails. Each outlet can have its own address and licence under Outlets.</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (loaded()) {
      <form class="card mt-3 grid gap-3 sm:grid-cols-2" (ngSubmit)="save()">
        <div class="sm:col-span-2"><label class="label" for="s-name">Shop name *</label><input id="s-name" name="name" class="field" [(ngModel)]="f.name" /></div>
        <div><label class="label" for="s-phone">Phone (10 digits)</label><input id="s-phone" name="phone" class="field" inputmode="numeric" [(ngModel)]="f.phone" /></div>
        <div><label class="label" for="s-gst">GSTIN</label><input id="s-gst" name="gstin" class="field" [(ngModel)]="f.gstin" /></div>
        <div class="sm:col-span-2"><label class="label" for="s-addr">Address</label><input id="s-addr" name="address" class="field" [(ngModel)]="f.address" /></div>
        <div><label class="label" for="s-dl">Drug licence no.</label><input id="s-dl" name="dl" class="field" [(ngModel)]="f.drugLicenseNo" /></div>
        <div>
          <label class="label" for="s-low">Low stock at (packs)</label>
          <input id="s-low" name="low" type="number" min="0" class="field" [(ngModel)]="f.lowStockDefault" />
          <p class="mt-0.5 text-[11px] text-ink-soft">A product with no reorder level of its own counts as low at or below this. 0 turns it off.</p>
        </div>
        <div class="sm:col-span-2 flex justify-end"><button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save settings' }}</button></div>
      </form>
    }
  `,
})
export class ShopSettings {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/shop`;

  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected f: Shop = { name: '', phone: '', address: '', gstin: '', drugLicenseNo: '', lowStockDefault: 5 };

  constructor() {
    this.http.get<Shop>(this.url).subscribe({
      next: (v) => {
        this.f = { ...v };
        this.loaded.set(true);
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  protected save() {
    this.error.set(null);
    this.notice.set(null);
    if (this.f.name.trim().length < 2) return this.error.set('Enter the shop name.');
    this.busy.set(true);
    this.http.patch<Shop>(this.url, { ...this.f, lowStockDefault: Number(this.f.lowStockDefault) || 0 }).subscribe({
      next: (v) => {
        this.f = { ...v };
        this.busy.set(false);
        this.notice.set('Saved. New bills will show these details.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
