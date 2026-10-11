import { Component, ViewEncapsulation, input } from '@angular/core';

/**
 * The frame every signed-out page sits in (sign in, free trial, forgot password, set password): a form on one side and a
 * picture of what Orvia does on the other. It reads the app theme's variables (--brand, --ink, --surface-solid ...), so it follows the
 * theme. On a tablet the two halves get narrower; on a phone they stack, with the picture on top, shorter.
 * The form goes in as the content; the classes it can use (au-lbl, au-field, au-btn ...) are defined once in auth.css for all those pages.
 */
@Component({
  selector: 'app-auth-shell',
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="au-page">
      <main class="au-frame">
        <div class="au-card" [class.au-one]="wide()">
          <section class="au-form-side"><ng-content /></section>

          @if (!wide()) {
          <aside class="au-visual" aria-label="About Orvia">
            <div class="au-top">
              <div class="au-logo">
                <div class="au-logo-mark"><svg viewBox="0 0 24 24" fill="none" stroke="var(--brand-ink)" stroke-width="3.6" stroke-linecap="round" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg></div>
                <div class="au-brand"><b>Orvia</b><small>ERP Retail Pharmacy</small></div>
              </div>
              <h2>{{ heading() }}</h2>
              <p>{{ text() }}</p>
              <ul class="au-feat">
                @for (f of features(); track f) {
                  <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>{{ f }}</li>
                }
              </ul>
            </div>
            <img class="au-cart" alt="Shopping cart filled with medicines" src="images/medicine-cart.webp" width="640" height="640" />
            <div class="au-copy">© {{ year }} Orvia. All rights reserved.</div>
          </aside>
          }
        </div>
      </main>
    </div>
  `,
})
export class AuthShell {
  readonly heading = input('Every batch, every expiry, under control.');
  readonly text = input('Billing, inventory and compliance for modern pharmacies, built to keep your shelves stocked and your counter fast.');
  /** a page with no picture side (the pricing list) */
  readonly wide = input(false);
  readonly features = input<string[]>(['Batch & expiry tracking (FEFO)', 'Fast barcode POS billing', 'GST & Schedule H1 compliance']);
  protected readonly year = new Date().getFullYear();
}
