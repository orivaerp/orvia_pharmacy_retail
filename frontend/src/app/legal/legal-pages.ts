import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../environments/environment';
import { Logo } from '../shared/components/logo';

interface Site {
  companyName: string;
  address: string;
  supportEmail: string;
  supportPhone: string;
  grievanceName: string;
  grievanceEmail: string;
}

export const LEGAL_UPDATED = '13 October 2026';

/** Who runs the service, from Provider > Settings. The pages still read well while this loads or if it cannot be fetched. */
function useSite() {
  const site = signal<Site>({ companyName: 'Orvia', address: '', supportEmail: '', supportPhone: '', grievanceName: '', grievanceEmail: '' });
  inject(HttpClient)
    .get<Site>(`${environment.apiUrl}/public/site`)
    .subscribe({ next: (s) => site.set(s), error: () => undefined });
  return site;
}

const FRAME = `
  <header class="legal-head">
    <a routerLink="/login" aria-label="Orvia sign in"><app-logo [size]="34" /></a>
    <nav class="legal-nav" aria-label="Legal pages">
      <a routerLink="/terms">Terms of use</a>
      <a routerLink="/privacy">Privacy policy</a>
      <a routerLink="/login">Sign in</a>
    </nav>
  </header>
`;

const STYLE = `
  .legal { min-height: 100vh; background: var(--surface-solid, #fff); color: var(--ink, #14332f); }
  .legal-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; max-width: 760px; margin: 0 auto; padding: 20px 16px 8px; }
  .legal-nav { display: flex; gap: 16px; font-size: 13px; }
  .legal-nav a { color: inherit; opacity: .75; text-decoration: none; }
  .legal-nav a:hover { opacity: 1; text-decoration: underline; }
  .legal-body { max-width: 760px; margin: 0 auto; padding: 8px 16px 64px; font-size: 14px; line-height: 1.7; }
  .legal-body h1 { font-size: 28px; font-weight: 600; margin: 16px 0 4px; letter-spacing: -.01em; }
  .legal-body h2 { font-size: 17px; font-weight: 600; margin: 28px 0 6px; }
  .legal-body p, .legal-body ul { margin: 8px 0; }
  .legal-body ul { padding-left: 20px; list-style: disc; }
  .legal-body li { margin: 3px 0; }
  .legal-body a { color: var(--brand, #067659); text-decoration: underline; }
  .legal-meta { font-size: 12px; opacity: .65; }
`;

@Component({
  selector: 'app-terms',
  imports: [RouterLink, Logo],
  styles: STYLE,
  template: `
    <div class="legal">
      ${FRAME}
      <main class="legal-body">
        <h1>Terms of use</h1>
        <p class="legal-meta">Last updated {{ updated }}</p>

        <h2>1. About these terms</h2>
        <p>These terms are between you (the pharmacy or business that opens an account, called "you") and {{ s().companyName }} ("we", "us"), who run Orvia, a web service for billing, stock and expiry management and accounts for medical stores. By creating an account or using Orvia you accept these terms. If you accept for a business, you confirm you may do so for it.</p>

        <h2>2. What Orvia is, and is not</h2>
        <p>Orvia is software. We do not run your pharmacy, check your prescriptions or advise on medicines. You remain responsible for selling lawfully: holding your drug licence, selling prescription medicines (Schedule H and H1) only as the law allows, and keeping the records the law requires. The prescription fields, registers and reports in Orvia help you keep records; they do not replace your duties.</p>
        <p>GST figures, GSTR-1 and GSTR-3B files and e-invoice files are worked out from the data you enter. Check them, or have your accountant check them, before you file. We do not file returns or e-invoices for you, and we are not responsible for a return filed from figures you did not check.</p>
        <p>The medicine catalog (names, salts, strengths, GST rates, HSN codes) is a reference we maintain with care. It can be wrong or out of date. Check an item before you rely on it, especially its price and tax rate.</p>

        <h2>3. Your account</h2>
        <ul>
          <li>Give correct information when you sign up and keep it up to date.</li>
          <li>You are responsible for everything done under your shop's account, including by the staff you add. Give staff only the role they need, and remove people who leave.</li>
          <li>Keep passwords private. We recommend two-step verification. Tell us at once if you think someone else has got in.</li>
        </ul>

        <h2>4. Free trial and plans</h2>
        <p>A new shop may start with a free trial. Plans differ in the number of outlets, staff, bills and features, as shown on the pricing page. When a trial or a paid period ends, you need to pay to continue; see the next section.</p>

        <h2>5. Fees and payment</h2>
        <ul>
          <li>Prices are shown before GST. GST is added at the rate in force and shown on your invoice.</li>
          <li>We send an invoice for each period. You can pay online from the Billing page or by bank transfer, using the details on the invoice.</li>
          <li>If an invoice is not paid by its due date, there is a short grace period. After that, your shop becomes <b>view-only</b>: you can see and download your data but cannot make new bills or changes until the invoice is paid. We may suspend an account that stays unpaid.</li>
          <li>Fees already paid are not refunded, unless we agree in writing or the law requires it.</li>
          <li>We may change prices for a future period. We will tell you before the change reaches you.</li>
        </ul>

        <h2>6. Your data</h2>
        <p>The business data you enter (products, stock, bills, customers, suppliers, staff) belongs to you. You allow us to store and process it only to provide Orvia to you, as set out in the <a routerLink="/privacy">Privacy policy</a>. You are responsible for having the right to enter your customers' details, and for telling them how you use them.</p>
        <p>You can download your reports and lists from Orvia. If you want a copy of all your data or want it deleted, write to us at the contact below.</p>

        <h2>7. Acceptable use</h2>
        <ul>
          <li>Do not use Orvia for anything unlawful, or to sell medicines you are not allowed to sell.</li>
          <li>Do not try to break into the service, test its security without our written permission, overload it, or copy or resell it.</li>
          <li>Do not enter data you have no right to enter, or send spam through the reminder and bill features.</li>
        </ul>

        <h2>8. Availability and changes to the service</h2>
        <p>We work to keep Orvia running and your data safe, but we cannot promise it will never be interrupted or free of mistakes. We may update, improve or remove features. Keep a way to bill customers (for example a printed receipt book) for the rare time the service is not available.</p>

        <h2>9. Ending your account</h2>
        <p>You may stop using Orvia at any time. We may suspend or end an account for non-payment, for serious or repeated breach of these terms, or if the law requires. After an account ends we keep your data for a reasonable time so you can ask for a copy, and then we may delete it. Some records we must keep by law may be kept for as long as the law requires.</p>

        <h2>10. Our responsibility</h2>
        <p>Orvia is provided "as is". As far as the law allows, we are not liable for indirect or consequential loss (such as lost profit, or a penalty because of a figure you filed without checking), and our total liability to you for any claim is limited to the fees you paid us in the 12 months before the claim. Nothing here limits a liability that cannot be limited by law.</p>

        <h2>11. Changes to these terms</h2>
        <p>We may change these terms. We will post the new version here with its date and, for important changes, tell the shop owner by email. Using Orvia after a change means you accept it.</p>

        <h2>12. Law and disputes</h2>
        <p>These terms are governed by the laws of India. Courts in India have jurisdiction. Please write to us first so we can try to settle a problem.</p>

        <h2>13. Contact</h2>
        <p>{{ s().companyName }}@if (s().address) { , {{ s().address }} }.
          @if (s().supportEmail) { Email <a [href]="'mailto:' + s().supportEmail">{{ s().supportEmail }}</a>. }
          @if (s().supportPhone) { Phone {{ s().supportPhone }}. }</p>
      </main>
    </div>
  `,
})
export class Terms {
  protected readonly s = useSite();
  protected readonly updated = LEGAL_UPDATED;
}

@Component({
  selector: 'app-privacy',
  imports: [RouterLink, Logo],
  styles: STYLE,
  template: `
    <div class="legal">
      ${FRAME}
      <main class="legal-body">
        <h1>Privacy policy</h1>
        <p class="legal-meta">Last updated {{ updated }}</p>

        <h2>1. Who this is about</h2>
        <p>{{ s().companyName }} ("we", "us") runs Orvia, billing and stock software for medical stores. This page explains what information we handle, why, and what you can ask of us. It follows the principles of India's Digital Personal Data Protection Act, 2023.</p>
        <p>There are two kinds of information, and our role differs:</p>
        <ul>
          <li><b>Your account information</b> (you, as the shop owner or staff). We decide how this is used, so we are responsible for it.</li>
          <li><b>Your shop's business data</b>, including details of your own customers, patients and suppliers. You decide what to enter and why. We store and process it for you, on your instructions, to provide Orvia. You are responsible for having the right to enter it.</li>
        </ul>

        <h2>2. What we collect</h2>
        <ul>
          <li><b>When you sign up or are added:</b> shop name, your name, email, phone number, city, role, and the plan you chose. The time you accepted the terms.</li>
          <li><b>Shop details you enter:</b> address, GSTIN, drug licence number, outlets, pharmacist details.</li>
          <li><b>Business data:</b> products, stock and batches, purchase and sale bills, returns, suppliers and what you owe them, customers (name, phone, email, address, GSTIN, what they owe), and, where the law requires it for Schedule H and H1 medicines, the doctor's and patient's name, age, address and the doctor's registration number.</li>
          <li><b>Payments:</b> the amount, mode and reference of each payment. We do not store card numbers or UPI PINs. Online payments go through Razorpay, which handles those details. If you save your own Razorpay keys, they are stored encrypted.</li>
          <li><b>Use and security records:</b> who did what and when (the activity log), sign-in times, and the IP address and browser of sign-ins, to keep accounts safe and to help when something goes wrong.</li>
          <li><b>Browser storage:</b> the sign-in tokens and a few preferences (such as the receipt paper size) are kept in your browser. We do not use advertising or tracking cookies.</li>
        </ul>

        <h2>3. Why we use it</h2>
        <ul>
          <li>to provide Orvia: billing, stock, reports, reminders, and the GST files you ask for;</li>
          <li>to bill you for your plan and keep accounts;</li>
          <li>to send what you need: invitations, password resets, invoices, security notices and the reminders you choose to send to your customers;</li>
          <li>to keep the service secure, prevent misuse and fix problems;</li>
          <li>to help you when you ask for support;</li>
          <li>to meet legal duties.</li>
        </ul>
        <p>We do not sell your data and we do not use your shop's data for advertising.</p>

        <h2>4. Who we share it with</h2>
        <p>Only with the services we need to run Orvia, and only as far as needed:</p>
        <ul>
          <li>cloud hosting and database providers, where the service and its data are kept;</li>
          <li>an email service (Amazon SES), to deliver the messages above;</li>
          <li>Razorpay, when you or your customer pays online;</li>
          <li>authorities, if the law requires it.</li>
        </ul>
        <p>Orvia staff can open your shop's data to help you only through a support session that needs a written reason, is read-only, lasts 30 minutes and is shown to you in your Support access page.</p>

        <h2>5. How long we keep it</h2>
        <p>While your account is active. After it ends we keep your data for a reasonable time so you can ask for a copy, and then delete it, except what we must keep by law (for example invoices and accounting records) for as long as the law requires.</p>

        <h2>6. How we protect it</h2>
        <p>Passwords are stored in a hashed form, never in plain text. Saved payment keys are encrypted. Access is limited by role, activity is logged, and you can turn on two-step verification. Connections to Orvia use HTTPS. No system is perfectly secure; if there is a breach that affects you, we will tell you as the law requires.</p>

        <h2>7. Your rights</h2>
        <p>You can ask us to show you the account information we hold, correct it, or delete it, to withdraw a consent you gave, and to nominate someone to act for you. Write to us at the contact below. If you are a customer of a pharmacy that uses Orvia, please ask the pharmacy first: it decides what it keeps about you, and we will help it act on your request.</p>

        <h2>8. Children</h2>
        <p>Orvia is for businesses. It is not meant for people under 18, and we do not knowingly collect their account information.</p>

        <h2>9. Changes</h2>
        <p>We may update this policy and will post the new version here with its date, and tell shop owners about important changes by email.</p>

        <h2>10. Contact and complaints</h2>
        <p>{{ s().companyName }}@if (s().address) { , {{ s().address }} }.
          @if (s().supportEmail) { Email <a [href]="'mailto:' + s().supportEmail">{{ s().supportEmail }}</a>. }
          @if (s().supportPhone) { Phone {{ s().supportPhone }}. }</p>
        @if (s().grievanceName || s().grievanceEmail) {
          <p><b>Grievance officer:</b> {{ s().grievanceName }}@if (s().grievanceEmail) { , <a [href]="'mailto:' + s().grievanceEmail">{{ s().grievanceEmail }}</a> }. We will answer a complaint within a reasonable time. If you are not satisfied, you may approach the Data Protection Board of India once it is functioning.</p>
        }
      </main>
    </div>
  `,
})
export class Privacy {
  protected readonly s = useSite();
  protected readonly updated = LEGAL_UPDATED;
}
