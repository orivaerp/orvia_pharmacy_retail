# Orvia: pending work

Written 15 October 2026, to pick up after the basic tests. What is built and how it works is in `ADMIN-README.md`; this file only lists what is left.
Order inside each part is the suggested order. Items marked **[you]** need something from the owner (a decision, an account or a device), not just code.

---

## 0. Do first: basic tests on a real shop

Everything so far was checked with scripts and the browser, not on real hardware or with real money.

- [ ] A pilot shop for 2 to 3 days: real bills, real stock, real staff.
- [ ] **80 mm receipt printer**, A4 bill, barcode **label** printer (only the generated page was checked). **[you]** needs the devices.
- [ ] **USB barcode scanner** at the counter, including a code that is not in the catalog (the "save it on this product" flow).
- [ ] **Razorpay** with real money: a UPI QR payment, Checkout, a refund back to UPI, the webhook. Only test keys were used.
- [ ] POS on a **real phone and tablet** (layouts were checked in a resized browser only).
- [ ] **Amazon SES:** production access, domain verified (DKIM, SPF, DMARC), a test email to Gmail and Outlook, check spam.
- [ ] **SES bounces:** create the SNS topic, subscribe `/api/v1/webhooks/ses`, set `SES_SNS_TOPIC_ARN`, then use `bounce@simulator.amazonses.com` and `complaint@simulator.amazonses.com` (steps are on Provider > Email).
- [ ] **GST files:** give the GSTR-1 and GSTR-3B JSON and the e-invoice JSON to an accountant and try them on the portal. The layouts follow the published formats but were never uploaded.
- [ ] Stock count on the shelf with real stock, then apply (check the "apply" figures against a manual count).
- [ ] Sign-up from the public pricing page to the first bill, on a phone.

## 1. Before launch (setup and decisions)

- [ ] **[you]** Fill Provider > Settings: company name, address, GSTIN, bank details, support email and phone, grievance officer.
- [ ] **[you]** Have a lawyer read the Terms of use and Privacy policy (`frontend/src/app/legal/legal-pages.ts`). Confirm the business choices in them: no refund of fees paid, view-only after the grace period, liability limited to 12 months of fees, Indian law.
- [ ] Hide the old placeholder plan "Trial" from the website (Provider > Plans, untick "Show on the website").
- [ ] Production run: `.env.production` shares database `oprmqa` with development; give production its own database. `CORS_ORIGIN=https://pharmacy.orviaerp.com`, `FRONTEND_URL`, `PUBLIC_API_URL`, `TRUST_PROXY=1` behind nginx.
- [ ] Captcha on the sign-up form (not built; only a honeypot and a rate limit exist).
- [ ] The marketing page `https://www.orviaerp.com/services/pharmacy-software` (the landing page itself is not built; the app only links to it).
- [ ] Optional: a shorter API address such as `api.pharmacy.orviaerp.com` (shops now see `stuintern.in` in the webhook address).
- [ ] Clear the Medicine Master data that is wrong after the earlier imports: the 21 Mankind rows (units per pack and status) from `medicine-master-brand-list-mankind-filled-v5.csv`. The import code is fixed; already-imported rows were not changed. **[you]** say yes to a repair script (it will list first, then update only `unitsPerPack` and `status`).
- [ ] Old medicines saved before the new forms (`dry syrup`, `solution`, `respules`) keep their old form until edited. A script by name can change them (list first). **[you]**
- [ ] Commit and push: SEO and share card, manufacturer filter, GST filing, Settings and legal pages, SES mail and bounce handling, new forms, import fixes. Nothing after the first push is committed yet.

## 2. Shop owner: important

- [ ] **Offline billing.** If the internet drops the counter cannot bill. Biggest risk for a medical shop; also the biggest piece of work.
- [ ] **Export all my data** and a delete-shop and data-retention process (the Terms say "write to support" for now).
- [ ] **Automated tests** in the repository (none; every test so far is a throwaway script).
- [ ] **Purchases:** cancel or edit a booked invoice; approval before an order is sent; compare prices with the supplier invoice; remind about late orders; receive several invoices at once; a PDF file (only the print window now).
- [ ] **Purchases and sales tax split:** purchases use CGST + SGST only (sales have IGST for B2B in another state).
- [ ] **Customer payments:** say which bill a payment settles (payments are per person now); customer opt-out of reminders.

## 3. Shop owner: daily convenience

- [ ] **Camera barcode scan** in the browser (phone and tablet). Only a USB scanner works now.
- [ ] **POS on phone:** payment and customer panels as bottom sheets.
- [ ] **Stock count:** a short "how to count" help box and a clear hint on empty fields (the screen confused a user); count a batch the system shows as zero (found stock); several people on one list; a printable count sheet; count one rack only.
- [ ] **Units wording:** show "30 tablets per pack" / "30 ml per pack" instead of "30 per pack" (the form is shown now, but not the unit). **[you]** confirm.
- [ ] **Plan change from inside the shop** (the provider changes it now, the owner pays on the Billing page).
- [ ] **Staff:** shop owner resets a staff member's 2FA; custom roles (roles are fixed templates now).
- [ ] **Reports:** expenses inside profit; recurring expenses (monthly rent); Z-report; notes and coins count at day close; separate cash per cashier or shift.
- [ ] **Bills:** cancel part of a bill (use a return today); a "cancelled bills" report; filter bills by status.
- [ ] **Label printing:** Code 128 and other barcode types, batch and expiry on the label, many products at once.

## 4. Shop owner: grow the business

- [ ] **Scheduled and SMS reminders** for udhaar and refills (email and WhatsApp are by hand now).
- [ ] Loyalty points, offers and discount schemes.
- [ ] Home delivery orders.
- [ ] Doctor and patient history.
- [ ] Send the bill itself as a PDF or from Orvia's own WhatsApp number (WhatsApp Business Platform); send to many customers at once; link expiry and "opened" counts.
- [ ] Import old bills and payment history; update existing customers or suppliers from a file; undo an import.
- [ ] `apiAccess` feature (an API for the shop's own systems).

## 5. Admin (provider) side

- [ ] **Alert** to the team when email delivery health turns to "Watch this" (SES can pause an account).
- [ ] An **unsubscribe link** in reminder emails; block by domain.
- [ ] **Billing:** prorated mid-period upgrades; automatic renewal by card or UPI mandate (every renewal is paid by hand now); credit notes; GST split by state on subscription invoices.
- [ ] **GST filing:** send returns and e-invoices straight to the portals (needs a GSP or IRP account); IRN and QR on the bill; GSTR-2B matching; reverse charge; amendments of an earlier month; quarterly (QRMP) layout; cess; e-way bills.
- [ ] **Audit log:** export to Excel, filter by outlet, an email when something unusual happens; failed sign-ins shown to the owner; events from before this existed are not backfilled.
- [ ] Review the Medicine Master: custom products from shops waiting in "Shop requests" (check what approve does to the shop's private product).
- [ ] Provider Settings: more values later if wanted (they are stored in the database; email server, payment keys and secrets stay in the environment on purpose).

## 6. Known limits (not bugs, just how it works today)

- Stock is held in units and shown in packs; one pack means one strip, bottle or tube (no box > strip > unit level). A three-level pack would need a new feature.
- Bills made before a product had a purchase rate show under "No cost" and stay out of profit.
- A return is a credit note in the month it was made; a bill cancelled in the same month it was made is left out of GST files.
- Medicine catalog import skips a medicine that already exists; it never updates it.
- Mail is off until the SES variables are set; invite and reset links are shown on screen meanwhile.
- The sign-up page is not shown to search engines as separate pages beyond `/login`, `/signup`, `/pricing`, `/terms`, `/privacy`; everything else is `noindex`.
