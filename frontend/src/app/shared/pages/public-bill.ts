import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { environment } from '../../../environments/environment';
import { SaleDetail } from '../../retail/sales/sales-api.service';
import { receiptHtml } from '../../retail/sales/receipt';

/** The bill a customer opens from the WhatsApp link: the same bill as printed, to read, print or save as PDF. No sign-in. */
@Component({
  selector: 'app-public-bill',
  template: `
    <main class="mx-auto max-w-3xl px-4 py-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h1 class="text-lg font-medium">{{ shop() ? shop() + ' - your bill' : 'Your bill' }}</h1>
        @if (loaded()) { <button type="button" class="btn btn-primary" (click)="print()">Print or save as PDF</button> }
      </div>
      @if (error()) { <p role="alert" class="mt-4 rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700">{{ error() }}</p> }
      @else if (!loaded()) { <p class="mt-4 text-sm text-ink-soft">Loading your bill…</p> }
      <iframe #frame title="Your bill" class="mt-3 h-[75vh] w-full rounded-xl border border-line bg-white" [class.hidden]="!loaded()"></iframe>
      <p class="mt-3 text-center text-[11px] text-ink-soft">Sent by the pharmacy with Orvia. Keep this link private: anyone who has it can read this bill.</p>
    </main>
  `,
})
export class PublicBill {
  private readonly http = inject(HttpClient);
  readonly token = input.required<string>();
  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly shop = signal('');

  constructor() {
    effect(() => {
      const t = this.token();
      const f = this.frame();
      if (!f) return;
      this.http.get<SaleDetail>(`${environment.apiUrl}/public/bills/${t}`).subscribe({
        next: (sale) => {
          this.shop.set(sale.shop?.name ?? '');
          // the page is built from the bill's own data with everything escaped, and shown in a frame of its own
          f.nativeElement.srcdoc = receiptHtml(sale, 'a4', false);
          this.loaded.set(true);
        },
        error: (e) => this.error.set(e?.status === 404 ? 'This bill link is not valid, or the pharmacy turned it off. Please ask the pharmacy to send it again.' : e?.status === 429 ? 'Too many tries. Please wait a few minutes and open the link again.' : 'The bill could not be loaded. Please try again.'),
      });
    });
  }

  protected print() {
    this.frame()?.nativeElement.contentWindow?.print();
  }
}
