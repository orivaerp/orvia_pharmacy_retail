# Orvia: Platform and Shop Guide (ADMIN-README)

What Orvia does today, how each part works, how to run and configure it, how it was checked, and what is still open.
Code: `backend/` (Node, Express 5, Mongoose, MongoDB Atlas) and `frontend/` (Angular 21, Tailwind 4).
The short developer README is `README.md`; this file is the working reference for the product itself.

Contents: 1 Run and configure · 2 What is built · 3 Roles and permissions · 4 Screens · 5 How each part works · 6 Data · 7 API · 8 Security · 9 How it was tested · 10 Go-live checklist · 11 Not built yet · 12 Decisions

---

## 1. Run and configure

```bash
cd backend && npm run seed && npm run dev      # API on http://localhost:5000/api/v1
cd frontend && npm start                       # app on http://localhost:4200
```

`npm run seed` creates the default plans, a platform super admin and a demo shop with an owner (logins come from the `SEED_*` values in your env file; they are never printed in this document). Other scripts: `seed:medicines` (sample catalog), `import:medicines -- "<file.csv>" [--apply]`, `backfill:saltkeys`, `seed:prod`.

The backend reads `.env.development` or `.env.production` according to `NODE_ENV`; real environment variables win over the file. MongoDB Atlas is required (transactions are used). `backend/.env.example` lists every variable.

| Variable | Needed | What it does |
|---|---|---|
| `MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | yes | database and token signing (secrets at least 16 characters) |
| `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES` | no | default 15m and 7d |
| `CORS_ORIGIN`, `FRONTEND_URL` | yes in production | allowed web origin; the base of links in emails |
| `PUBLIC_API_URL` | production | public address of the API, shown to shops as their webhook URL |
| `SETTINGS_ENCRYPTION_KEY` | production | 64 hex characters; encrypts shops' payment keys and everyone's 2FA secret. **Keep a copy: without it those cannot be read.** Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | for UPI and for billing | Orvia's own keys, used **only** for the shops' subscription invoices. A shop's customer payments never use them: a shop must add its own keys (a shop without keys gets an explanation box on the counter instead of the Razorpay box). Test keys in development, live keys in production |
| `RAZORPAY_WEBHOOK_SECRET` | production | secret for the platform webhook `/api/v1/webhooks/razorpay` |
| `SMTP_HOST`, `SMTP_PORT` | for email | the mail server. For **Amazon SES**: the SMTP endpoint of your region, e.g. `email-smtp.ap-south-1.amazonaws.com`, and port 587 (STARTTLS; 2587 also works) or 465 (SSL). `SMTP_SECURE` is only needed to override the port's usual choice (true only for 465) |
| `SMTP_USER`, `SMTP_PASS` | for email | the SES **SMTP credentials** made in the SES console (SMTP settings, Create SMTP credentials). They are not your AWS access key, and the user name is not an email address |
| `MAIL_FROM`, `MAIL_REPLY_TO` | for email | `MAIL_FROM` is the sender, a full `Name <address>` that is a **verified SES identity** (the address or its whole domain); the login is never used as the sender. `MAIL_REPLY_TO` is where a reply goes when a message does not name its own (a customer reminder replies to the member of staff who sent it; invitations, resets and invoices use `MAIL_REPLY_TO`). Without `SMTP_HOST` and `MAIL_FROM` nothing is emailed and links are shown on screen instead. The old `EMAIL_USER`, `EMAIL_PASS` and `EMAIL_FROM_NAME` are no longer read |
| `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_GSTIN`, `BANK_DETAILS` | for invoices | printed on subscription invoices |
| `BILLING_GST_PERCENT`, `BILLING_GRACE_DAYS`, `BILLING_JOBS` | no | defaults 18, 7, on (the GST rate can also be set in Provider > Settings, which wins over the env value; 0 means no GST) (`false` switches the daily billing job off) |
| `REQUIRE_PLATFORM_2FA` | no | default: on in production, off in development |
| `LOGIN_RATE_LIMIT` | no | sign-in attempts per IP per 15 minutes, default 20 |
| `SIGNUP_TRIAL_DAYS`, `SIGNUP_RATE_LIMIT` | no | free-trial length for a paid plan that has no trial of its own (default 14), and sign-ups per IP per hour (default 10) |
| `TRUST_PROXY` | production | how many reverse proxies (nginx, a load balancer) are in front of the API: 1 behind one nginx, 0 when reached directly. **Without it every visitor looks like the proxy, so the sign-in and sign-up limits count everybody together.** |

Things worth knowing while developing:
- After a permission is added, users must sign out and in once (permissions travel in the token for the browser; the server re-reads role, outlets and active status on every request).
- The browser shares one session between tabs. A stale tab holding a deleted shop's session logs the other tab out when it gets a 403.
- Saving a file under `backend/` restarts nodemon, so a test script placed there briefly drops the server.

---

## 2. What is built

| Area | State |
|---|---|
| Shops: onboarding with owner invite, suspend and activate, plan change, edit details, real Overview numbers | Done |
| Plans and limits: outlets, users, **products, bills per month**, feature flags, all enforced on the server | Done |
| **Subscription billing**: invoices, Razorpay payment, trial, grace, view-only lock, reminders, provider Billing page | Done (live payment untried, see section 9) |
| Medicine Master: catalog, CSV import (generic list, brand list, supplier list), duplicates, substitutes, shop requests | Done (catalog data needs your review) |
| Shop products: add from catalog, custom products, barcode memory, reorder level | Done |
| Outlets: owner adds and manages, provider limits and requests, outlet switcher, per-outlet staff access | Done |
| Staff: roles, outlets, invite links, deactivate | Done |
| Stock: entry (opening, purchase), batches, append-only ledger, adjustment, transfer between outlets, history | Done |
| Purchasing: suppliers, invoices with GST and free packs, payments and balance, purchase returns | Done |
| **POS billing**: search and barcode, FEFO batches, GST, Schedule H/H1 details, split payment, hold, A4 and 80mm print, returns | Done |
| **Customers and udhaar (credit)**: list, limit, payments, statement, picker on POS, dues report | Done |
| **UPI at the counter** (Razorpay): QR on screen, Checkout fallback, per-shop keys, webhook, unclaimed payments, UPI refunds | Built and tested against Razorpay test mode |
| **Reports** (11) with CSV download | Done |
| Dashboard with real sales and stock numbers | Done |
| Support access: read-only, reason-required, 30 minutes, visible to the owner | Done |
| **Audit log** screen with filters and CSV | Done |
| **Platform users** and **two-step verification (2FA)** | Done |
| **Email** (SMTP): invitations, forgot password, security notices, invoices | Done (needs your SMTP details) |

---

## 3. Roles and permissions

Permissions are checked on the server; the sidebar and routes follow them. Role names are never tested in code.

| Role | Level | Permissions |
|---|---|---|
| `super_admin` | Orvia | everything |
| `support` | Orvia | `tenant.view`, `support.view`, `user.view`, `branch.view`, `inventory.view`, `reports.view` |
| `shop_owner` | shop | every shop permission, including `billing.manage` and `user.manage` |
| `branch_manager` | shop | `user.view`, `branch.view`, `inventory.view`, `inventory.adjust`, `product.manage`, `purchase.create`, `purchase.approve`, `sales.create`, `reports.view` |
| `pharmacist` | shop | `branch.view`, `inventory.view`, `sales.create` |
| `cashier` | shop | `branch.view`, `sales.create` |
| `store_keeper` | shop | `branch.view`, `inventory.view`, `inventory.adjust`, `product.manage`, `purchase.create` |
| `accountant` | shop | `branch.view`, `reports.view` |

Orvia-only permissions: `tenant.view`, `tenant.manage`, `plan.manage`, `medicine.manage`, `support.view`, `audit.view`, `platform.users.manage` (also Email), `billing.admin`. Staff are tied to outlets; the owner sees all. Role, outlets and active status are re-read on every request, so a change or a deactivation applies at once (this includes Orvia staff).

---

## 4. Screens

**Orvia (provider)**, under `/provider`: Overview · Shops (list, detail with plan and usage, outlets, **Billing** box, "View shop data") · Plans · **Billing** · Outlet requests · Medicine Master · Shop requests · Platform users · **Email** · **Audit log** · **Security** · **Settings**.

**Shop (retail)**, under `/retail`: Dashboard · **New sale** · Products · Inventory (+ Add stock, Stock history) · Suppliers · Purchases · Outlets · Staff · **Bills** · **Customers** · **Payments** · **Billing** · **Reports** · Support access · **Security** · **Settings**.

---

## 5. How each part works

### 5.1 Shops and onboarding
The provider adds a shop (name, code, drug licence, GSTIN, plan, owner name and email). The server creates the shop, a default outlet (`MAIN`) and the owner user, and sends the owner a "set your password" link (7 days, one use, hashed in the database; also shown to the provider to copy). A plan with trial days starts a trial; a paid plan with no trial is billed from day one. Suspending a shop blocks every request of its users at once (data is kept); activating brings it back.

### 5.2 Plans, limits and features
A plan has a price (before GST), cycle, trial days, `maxOutlets`, `maxUsers`, `maxProducts`, `maxBillsPerMonth` (empty = unlimited) and feature flags. Effective outlet limit = plan limit + extra outlets granted by the provider.
- **Limits** are checked when something is added: outlet, user, product (also when adding many at once, and for custom products) and every bill (counted per calendar month, India time). A refusal names the plan, the limit and the use ("Your Basic plan allows 500 bills a month, and you have used 500"). Moving a shop to a plan smaller than its usage is refused.
- **Features:** `multiOutlet` (stock transfers), `onlinePayments` (UPI QR and Checkout at the counter), `gstReports` (GST summary and purchase GST), `barcodeBilling` (a scanned barcode finds the product on the POS; name search always works). `apiAccess` has nothing behind it yet and is labelled so.

### 5.3 Subscription billing
- **Invoices** belong to the platform (not to a shop's data): numbered `INV-2026-000001` across all shops; amount = plan price, plus `BILLING_GST_PERCENT` GST (18 by default; set it to 0 in Provider > Settings or the env file for no GST: then no GST line is printed and the document is titled "Invoice") (one GST line, not split into CGST/SGST/IGST); printable A4 tax invoice with the `COMPANY_*` and `BANK_DETAILS` details.
- **The daily job** (runs one minute after the server starts, then every 6 hours) issues the next invoice 7 days before a trial or paid period ends, emails the owner, and reminds from 3 days before the due date (at most one every 2 days, 6 in all). It is safe on several servers because a period is never invoiced twice. Provider > Billing > "Run billing now" runs it by hand.
- **Paying:** the owner opens Billing and pays with Razorpay Checkout (UPI, cards, netbanking) on the **platform's** keys, never a shop's own. The browser result is verified with Razorpay; if the browser closes, the platform webhook marks the invoice paid. Money that arrives otherwise (bank, cash) is marked paid by a super admin with a reference.
- **The period:** paid early, the new period starts when the old one ends; paid late, it starts now, so a shop never pays for unusable days.
- **States:** trial · active · due soon (within 7 days) · **grace** (period over; `BILLING_GRACE_DAYS`, 3 days after a free trial) · **locked** · suspended. A banner on every shop screen shows when attention is needed. **Locked** shops can sign in, see everything and pay, but anything that changes data is refused with HTTP 402. The provider can give more time from the shop page (a trial gets longer; a late shop gets a grace extension).
- **New and existing shops:** a shop that existed before billing (the demo shop) got one free period from the day billing first ran. Free plans are never billed or locked. A trial moved to a paid plan keeps its remaining days; a paid shop moved to a free plan forgets its old period.
- Provider > Billing shows monthly recurring revenue, collected this month, unpaid and overdue, with mark paid, void (a new invoice can replace it) and view.

### 5.4 Medicine Master (the common catalog)
One platform-owned list (no `tenantId`); shops pick from it with "Add to inventory" and the product **links** to the master (a fix in the master reaches every shop). Medicines carry name, brand, composition, strength, form, pack size, manufacturer, HSN, GST, schedule, barcodes, category and a status (`verified`, `pending`, `inactive`). Shops see only verified medicines.
- **Not in the catalog?** The shop creates a private custom product at once (billing never waits) and may suggest it; the provider approves, merges or rejects in **Shop requests**. The server refuses a custom copy of a verified catalog medicine (same barcode, or same name, strength and form).
- **Substitutes:** rows with the same salts, strength and form share a salt key ("Same salt"). Run `npm run backfill:saltkeys` after bulk changes made outside the app.
- **Import (CSV):** the importer recognises a generic list (Generic Name / Unit Size / MRP / Group Name, like the Jan Aushadhi list: it works out form, strength, salts and pack, and fills manufacturer "Generic (unbranded)", HSN 3004, GST 5%, schedule H for medicine groups, OTC for consumables), a **branded list** (Brand Name, Manufacturer, Composition, Strength, Form, Pack, MRP, Barcode, HSN, GST, Schedule, Category), and the standard template. Dry run first; **everything imported from a supplier list is `pending`** and needs a person to check schedule, GST and HSN before verifying. Re-running is safe.
- **Data quality:** the bundled sample (71 medicines) and the imported supplier list have best-effort schedule, GST and HSN. **Verify them before real use.** Catalog search is a plain name, salt, manufacturer and barcode match, fine for thousands of rows.

**Drug schedules** (simplified; confirm exact rules, registers and retention with CDSCO, your state drug controller or a legal adviser):

| Schedule | Meaning | What the software does |
|---|---|---|
| OTC | no schedule, sold without prescription | plain bill |
| H | prescription of a registered doctor | doctor and patient name required on the bill |
| H1 | stricter H (some antibiotics, TB and psychotropic drugs); a separate register is kept | doctor name and **registration number**, patient name required; the **Schedule H/H1 register** report lists every such sale |
| X | habit-forming, strictest control | **not sold at the standard counter** |
| NDPS | narcotic and psychotropic (NDPS Act) | **not sold at the standard counter** |

A shop cannot change a catalog medicine's schedule.

**Sample files** (in `backend/data/samples/`, and offered as download links in the import dialog from `frontend/public/samples/`; rebuilt by a script, not by hand): `medicine-master-sample.csv` (45 medicines, every column: name, brand, composition with salts separated by `;`, strength, form, unitsPerPack, manufacturer, hsn, gstPercent, schedule, category, barcodes (several with `;`), referenceMrp, externalCode, status), `medicine-master-brand-list-sample.csv` (a company or distributor list: Brand Name, Manufacturer, Composition, Strength, Form, Pack, MRP, Barcode, HSN, GST, Schedule, Category; imported as pending), `medicine-master-generic-list-sample.csv` (Jan Aushadhi style: Generic Name, Unit Size, MRP, Group Name; Orvia guesses salt, strength, form and pack; pending) and `medicine-master-sample-with-mistakes.csv` (a wrong GST, form, schedule, a missing manufacturer and salt, a repeated row and a repeated barcode, to see how the check reports them). The names, makers, prices, schedules and GST in them are illustrative and the barcodes are made up: check them before marking a medicine verified. All four were run through the import check (dry run) and behave as described.

- **Export (Provider > Medicine Master > Export):** downloads the whole catalog, or just what the search and filters (form, status, manufacturer) show, as a CSV (`GET /provider/medicines/export`, `tenant.view`, audited as `medicine.export` with the filter and the count). The columns are the ones the standard import reads (name, brand, composition, strength, form, unitsPerPack, manufacturer, hsn, gstPercent, schedule, category, barcodes, referenceMrp, externalCode, status), so a file can be edited and imported again; but import never updates a medicine that already exists. Salts and barcodes are joined with `;`. A cell that starts with = + - or @ gets a leading apostrophe so Excel does not run it as a formula. Written row by row. Tested: all 4062 rows, a filtered export equal to the filtered list, an exported sample read back by the import dry run with no errors.

- **Numbers and page size on the list (Provider > Medicine Master):** a row of cards above the list (`GET /provider/medicines/stats`, whole catalog, not the filter): total medicines and how many were added in the last 7 days; verified, pending and inactive with their share (click a status card to filter the list to it, click again to clear); number of manufacturers; forms in use (with the biggest three); count by schedule (OTC, H, H1, X, NDPS); medicines with a barcode; and a link when shops have suggested medicines waiting in Shop requests. Under the list: "Showing a to b of n", a **Rows** choice of 10, 25, 50, 75 or 100 (remembered in the browser; the server never returns more than 100), and Previous / Next.

### 5.5 Outlets and staff
- **Outlets** (`/retail/outlets`): the owner adds outlets (name, code, address, optional compliance fields: drug licence, GSTIN, pharmacist name and registration number, printed on bills), edits, closes and reopens (never deletes). The limit is enforced on the server. An outlet with stock cannot be closed; the last active outlet cannot be closed; the code never changes. "Request more outlets" sends a note to the provider, who approves with a count or rejects with a reason; the provider can also add or close outlets on a shop's behalf and grant extra outlets.
- **Outlet switcher** (top bar, when there is more than one outlet) filters Inventory, POS, Bills, Reports and the dashboard. Staff only ever receive their own outlets.
- **Staff** (`/retail/staff`): the owner adds branch managers, pharmacists, cashiers, store keepers and accountants, each tied to outlets, and gives them a password link. The owner account can only be changed by the provider. The plan's user limit applies.

### 5.6 Stock
Quantities are stored in **units** and shown in packs. Every movement is an append-only ledger row (`OPENING`, `PURCHASE`, `PURCHASE_RETURN`, `SALE`, `RETURN`, `ADJUST`, `TRANSFER_IN/OUT`); current stock is a cached sum per batch that never goes below zero.
- **Add stock** (`/retail/inventory/add`): outlet, type (opening or purchase), then lines with batch, expiry month, MRP, purchase rate and packs. An expired batch is rejected; a batch number can be received again only with the same expiry and MRP. All lines save in one transaction.
- **Adjust** (breakage, expired, damaged, lost: remove only; found: add only; count correction; other needs a note) and **Transfer** between outlets (one transaction; the destination gets the same batch number, expiry and MRP; expired batches cannot be moved). Both need `inventory.adjust`; transfer also needs the `multiOutlet` feature.
- **Stock history** lists every movement with type filter. "Expiring" means within 90 days.
- **Order list** (Inventory > Order list, `inventory.view`): every product that is low or out of stock, with a suggested number of packs (the product's **Maximum** minus what is on the shelf; with no Maximum, twice its reorder level), packs sold in the last 30 days, the supplier you last bought it from and that rate. Change a quantity or supplier, untick items, then per supplier **copy the text for WhatsApp, print, or download CSV**. It does not create a purchase (batch, expiry and rate are only known when the goods arrive: book them under Purchases then). A Maximum is set per product on the Products page.
- **Low-stock alert:** a product counts as low when its packs are at or below its own "Reorder at" (Products page); a product with no level of its own uses the **shop-wide default** (5 packs, set on the Inventory page by anyone with `product.manage`; 0 switches it off). Out of stock is always flagged. The Inventory list, the dashboard card and the Low stock report all use the same rule.

### 5.7 Purchasing
- **Suppliers:** name, GSTIN, drug licence, credit days, opening balance (what the shop already owed), and a statement of invoices, payments and returns with a running balance.
- **Purchase invoice** (`/retail/purchases/new`): supplier, outlet, supplier invoice number and date, then lines (batch, expiry, MRP, rate per pack, billed packs, free packs, discount %, GST %). Saving books the invoice **and** receives the stock in one transaction. Line taxable = packs x rate less discount; GST on that; invoice total rounded to the rupee with the round-off shown; free packs add stock but are not billed; batch cost per pack = taxable value / all packs received. A supplier invoice number is accepted once per supplier. Due date = invoice date + credit days.
- **Payments** (`purchase.approve`) reduce the supplier balance (per supplier, not matched to an invoice). **Returns** are made from an invoice; the packs leave the outlet's stock and the credit (cost plus GST) reduces the balance.

### 5.8 POS billing
- **New sale:** search by name or composition, or scan a barcode (Enter on a scan that finds one product adds it). Quantity in packs, loose units where the product allows them, a discount per line, and a batch choice per line (default earliest expiry, FEFO; a bill spanning batches shows one line per batch).
- **Saving a bill** writes the bill, the stock deduction and the ledger rows in **one transaction**; stock can never go negative. MRP already includes GST: the tax is carved out of the price, GST summary per rate is on the bill, and the total is rounded to the rupee.
- **Schedule H/H1** needs doctor and patient (H1 also the registration number), checked on the screen and on the server; X and NDPS are refused.
- **Payments:** cash, UPI, card, **on credit (udhaar)**, split across modes; the total must equal the bill.
- **Hold bill:** park a bill (no stock taken), resume later from the same outlet (up to 20); on resume stock and prices are re-checked and items that ran out are dropped with a message.
- **Print:** A4 bill or 80mm receipt (remembered per browser) showing the shop's name, address, phone, GSTIN, drug licence, bill number, batches and a GST summary. Reprint from the bill page.
- **Returns** (`purchase.approve`: owner, manager): pick units per bill line; they go back to the same batch; refund as cash, UPI, card, on credit, or back to the customer's UPI through Razorpay.
- **Bills** (`/retail/sales`): list with search and dates; bill page with returns and reprint.

### 5.9 Customers and udhaar
A customer has a name, a 10-digit phone (unique in the shop), optional email and address, an optional **udhaar limit** (0 = none) and an optional opening balance. Typing a phone on a bill finds or creates the customer; a cash walk-in bill creates none. **On credit** needs a customer, and a bill that would cross the limit is refused with the amounts.
**Owes** = opening balance + udhaar on bills - payments received - returns settled on credit. "Receive payment" records money (never more than owed). The customer page shows a statement in the order things happened with a running balance, and all bills. Payments are never edited or deleted (corrections are new entries). Customer dues also appear as a report.
**Udhaar reminders:** on the customer page, "Email reminder" sends the customer a polite note (amount pending, the shop's phone and address) under the **shop's name**, from the platform mailbox, with the sender's email as Reply-To, so replies reach the shop. A customer is reminded at most **once every 3 days** (the screen says when the next is allowed), only if they owe money and have an email; the page shows when and how often they were reminded. "Email reminder to all" on the Owes-money tab (owner and manager, `purchase.approve`) reminds everyone who qualifies, up to 200 at a time, and reports how many were sent, had no email, or were reminded recently. "WhatsApp reminder" opens WhatsApp (the owner's own phone or web) with the message typed in; nothing is sent until they press send there, and it works with no provider or cost. Every reminder is in the audit log. Not built: automatic scheduled reminders, SMS, and customer opt-out.

### 5.10 UPI at the counter and refunds (Razorpay)
- **Show QR for ₹X:** a single-use Razorpay UPI QR (10 minutes); the screen checks every 3 seconds and, when the money arrives, the bill is ready to save; Cancel closes the QR so it cannot be paid later. **Other ways to pay** opens Razorpay Checkout (UPI app or UPI ID). If the customer already paid on the shop's own QR, the bill can be saved with plain "UPI".
- **Nothing is trusted from the browser:** the server checks the signature, asks Razorpay that the payment is captured for the same amount, and one payment can pay one bill only (`created` > `paid` > `used`). If the bill amount changes after the money arrived, saving is blocked until it matches.
- **Keys:** a shop can save its **own** Razorpay keys on `/retail/payments` (owner only). They are checked with Razorpay, stored AES-256-GCM encrypted and never returned. **Without them there is no online collection** (Orvia's keys are never used for a shop's customers): the counter shows a box that says to add Razorpay keys under Accounts > Payments (a link for the owner), and the bill can still be saved with plain UPI when the customer paid on the shop's own QR. Refunding a payment taken earlier with Orvia's keys still uses them. Money received but never put on a bill (screen closed) is listed on the same page.
- **Webhooks:** `/api/v1/webhooks/razorpay/:tenantId` (shop keys, with the shop's own webhook secret) and `/api/v1/webhooks/razorpay` (platform keys). Signed; they only move an order to paid, update refund status, or mark a subscription invoice paid. They never create a bill.
- **UPI refunds:** on a bill paid through Razorpay, a return can go back to the customer's UPI, up to what was paid by UPI on that bill (the rest in cash). The return and stock are saved first, then Razorpay is asked; the bill shows sending, on its way, refunded or not sent. A failed refund keeps the return and offers "Try the UPI refund again"; a retry first checks Razorpay for an earlier refund of the same return, so a customer is never refunded twice.
- Razorpay's test mode does not offer UPI Payment Links; Orders + Checkout and QR Codes are used.

### 5.11 Reports
Under Accounts > Reports (`reports.view`: owner, manager, accountant); they follow the outlet in the top bar and a staff member's own outlets. Dates are India time, ranges up to a year, every report downloads as CSV (opens in Excel).
Daily sales (by payment mode, after refunds) · GST summary (per rate, after returns; needs `gstReports`) · Items sold · **Profit by medicine** · **Profit by day** · **Profit and loss** · **Expenses** · Schedule H/H1 register · Expiry (30/60/90 days or expired, valued at cost and MRP) · Low stock · Purchases · By supplier · Purchase GST (needs `gstReports`) · Supplier dues · Customer dues. The dashboard shows today's sales (against yesterday), the month, how customers paid, the last 7 days, recent bills and stock alerts, per outlet and per role.

**Profit reports.** Profit = sales before GST minus cost, after returns (a return takes back its share of both; it is counted on the day of the original bill). Cost is the batch's purchase rate (before GST, after supplier discount, free packs spread over all packs received), **stored on each bill line when the bill is made** (`cost`, `costKnown`), so a later purchase at a new rate does not rewrite old profit. Bills made before this was stored use the batch's purchase rate today. A batch with **no purchase rate** (for example opening stock entered without one) has an unknown cost: its sales show under **No cost** and are left out of profit and margin, so profit is never overstated by assuming a cost of 0. Margin = profit / sales that have a cost. Not included: expenses (rent, salary), discounts from suppliers given later as credit notes, input GST. Uses the same `reports.view` permission as the other reports.

### 5.12 Support access (view as)
Orvia staff with `support.view` (support role, super admin) can look at a shop's data only through a session: started from the shop page with a written reason (at least 10 characters), **read-only** (no write routes exist behind it), 30 minutes, tied to the person who started it. Areas: suppliers (with statement), purchases, stock, stock history, products. Starting and ending are audited, and the **shop owner sees every session** (who, why, when, what was opened) under Support access.

### 5.13 Audit log
Provider > Audit log (`audit.view`, super admin). Who did what, when and in which shop, across shops, plans, medicines, outlets, staff, stock, purchasing, sales, payment keys, support access, team and sign-ins, billing. Filter by area, dates or free text; click a row for details and IP; download up to 1000 entries as CSV. Append-only: there is no edit or delete in the API.

### 5.14 Platform users and 2FA
- **Platform users** (`platform.users.manage`, super admin): add Orvia staff as `super_admin` or `support`, change role, switch off or on, send a new password link, clear someone's 2FA after a lost phone. There is always at least one active super admin, and nobody can change or switch off their own account.
- **2FA** (any user, on the Security page): authenticator app (6-digit TOTP), 8 single-use recovery codes shown once and stored only as hashes, secret stored encrypted. Sign-in is password, then code. A code works once; 5 wrong codes lock sign-in for 10 minutes. Turning 2FA off or making new recovery codes needs the password and a current code.
- **Orvia staff must use 2FA** when `REQUIRE_PLATFORM_2FA` is on (the production default): until it is set up they can open only the Security page, and they cannot turn it off. If `SETTINGS_ENCRYPTION_KEY` is missing the rule is not enforced (nobody could set it up).

### 5.15 Email
SMTP (nodemailer) through **Amazon SES** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_REPLY_TO`). Tested here against local fake SMTP servers that answer like SES (accepted, login refused 535, address not verified 554, sending rate exceeded 454), not against Amazon itself, and earlier against a GoDaddy mailbox. The failure messages name the SES cause (wrong SMTP credentials or region, unverified sender or recipient, throttling). The display name of a shop's mail is the shop's, the address is always `MAIL_FROM`. On a non-SSL port the password is only sent over TLS. Emailed: set-password links (owner, staff, Orvia staff; 7 days), **forgot password** (1 hour, from the login page), security notices (password changed, 2FA turned off or cleared), and subscription invoices, reminders and receipts. Forgot password answers the same for known and unknown emails, and an email in several shops gets one link per shop. **A reset link on an account with 2FA sets the password but does not sign in** (password and code are still needed), and a password change ends every older session. Provider > Email shows whether mail is set up (never the password), sends a test and lists recent sends; the body of a message is never stored. If the mail server is down the action still succeeds and the screen shows the link.

### 5.16 Shop settings and phone / tablet POS
- **Settings** (`/retail/settings`, owner side with `user.manage`): shop name, phone, GSTIN, address, drug licence number (printed on bills and used in customer emails) and the shop-wide low-stock level. API: `GET /shop` (any shop user), `PATCH /shop` (`user.manage`, audited as `shop.update`). Outlets keep their own address and licence.
- **POS on phone and tablet:** below 768px each bill item is a card (big fields, number keyboard) instead of a table; below 1024px a bar fixed at the bottom shows the total and **Save bill**, with any error. Desktop is unchanged. Not built: payment/customer panels as bottom sheets, camera barcode scanning.
- **Barcodes are shop-wise.** Many packs (loose strips, small makers) have no barcode in the catalog. When a scanned code matches nothing, POS says so; the cashier searches the medicine by name and taps it, and (owner/manager, `product.manage`) the barcode is saved on that shop's product via `POST /products/:id/barcode`. The next scan adds it directly. It never reaches other shops or the catalog. A barcode already on another product of the shop, or belonging to another catalog medicine, is refused. Cashiers are told to ask a manager. Scanning needs the plan feature `barcodeBilling`. On **Products > Edit** the Barcodes box lists the catalog's barcodes (read-only) and the ones the shop saved (with Remove, `DELETE /products/:id/barcode?barcode=`), and lets the owner/manager add one by typing or scanning. Add and remove are in the audit log (`product.barcode_add`, `product.barcode_remove`). **Labels:** a product with no barcode gets the shop's own one with "Make a barcode for this product" (`POST /products/:id/barcode/generate`, an EAN-13 starting with 2, the range reserved for in-store use, so it cannot clash with a maker's code; audited as `product.barcode_generate`). "Print labels" in the same dialog prints N copies (name, barcode, number, optional MRP) on a 50 x 25 mm roll or an A4 sheet of 3 across, via the browser print window (no printer driver needed). Only valid EAN-13 codes are drawn (drawn by our own small encoder, checked against the JsBarcode library on 500 random codes). Not built: Code 128 / other barcode types, batch and expiry on the label, printing labels for many products at once. **Not tested:** a real label printer or scanner (only the generated page).

### 5.17 Import products and stock from Excel / CSV
- **Import data** in the shop sidebar (`/retail/import`, owner/manager: needs `product.manage` and `inventory.adjust`). The file (.xlsx or .csv, first sheet, first row = column names) is read **in the browser** (library `read-excel-file`); the server only gets plain rows. A blank template can be downloaded. Up to 2000 rows per import.
- **Columns:** Orvia guesses what each column is from its name (Item Name, Company, Batch No., Exp. Date, M.R.P., Qty, Pur Rate, GST %, Barcode ...) and the owner can change any guess. One field comes from one column.
- **Which product is each row?** (1) a barcode already on a shop product, or a catalog medicine with that barcode; (2) the shop's own product with the same name (Strength, Manufacturer and Form narrow it down); (3) a verified catalog medicine with the same name (added to the shop, medicine facts come from the catalog); (4) otherwise a new private product, which needs **Form and GST %** (composition defaults to the name, HSN 3004, schedule OTC, manufacturer Unknown). Two matches with no way to choose are an error that says what to add.
- **Stock:** a row with a quantity needs batch, expiry and MRP; expiry accepts 08/2027, 8/27, Aug-27, 2027-08, 31/08/2027 and real Excel dates. Quantity is in packs (whole numbers). A row with no quantity only adds the product. Opening stock goes into the outlet chosen in the top bar (ledger type OPENING, reference "Excel import").
- **Safe by design:** the screen first shows a preview (what each row becomes, errors, warnings); nothing is written until Import. The server re-checks everything on import and skips rows with errors. Rows for a batch that is **already in stock** (same product, outlet and batch number) would be added on top, so the owner must tick a confirmation; a batch with a different expiry or MRP from the one in stock is an error. The plan's product limit is checked for the whole file first (all or nothing). Barcodes in the file are saved on the product (shop-wise) and the rack on products that had none. Stock is saved 100 rows per transaction. Audited as `import.stock`.
- **Customers and suppliers** (tabs on the same page, owner and managers only because they carry opening balances: `purchase.approve` plus `sales.create` / `purchase.create`). Customers: name, phone, email, address, **already owes** (becomes the opening udhaar balance), udhaar limit, notes. Suppliers: name, GSTIN, drug licence, phone, email, address, city, state, credit days, **what we owe** (can be negative), notes. Phone numbers are cleaned to 10 digits (+91 and spaces removed). Existing records are **never changed**: a customer with the same phone (or, with no phone, the same name) and a supplier with the same name or GSTIN are skipped, also inside the file. A blank template (header only) can be downloaded. Audited as `import.customers` / `import.suppliers`.
- API: `POST /import/stock[/preview]`, `POST /import/customers[/preview]`, `POST /import/suppliers[/preview]`.
- Not built: importing old bills or payment history; updating existing customers/suppliers from a file; the old .xls format (save as .xlsx); undoing an import (use stock adjustment, or deactivate the customer/supplier).

### 5.18 Expenses and the day's cash count
- **Expenses** (Accounts > Expenses, `/retail/expenses`, owner and managers: `purchase.approve`): date (not in the future), category (Rent, Salary, Electricity and water, Transport, Packaging, Repairs and maintenance, Marketing, Licence and fees, Tea and misc, Other), amount, paid by (cash from the drawer, UPI, bank, cheque), outlet or whole shop, note. An expense is **never edited or deleted**: it is cancelled with a reason and stays on record (`expense.create`, `expense.void` in the audit log). Buying medicines is a purchase, not an expense. Reports: **Expenses** (list) and **Profit and loss** = gross profit (see the profit reports above) minus expenses by category = net profit; with one outlet chosen only that outlet's expenses count. API: `GET/POST /expenses`, `POST /expenses/:id/void`.
- **Day close** (Accounts > Day close, `/retail/cash-close`, owner and managers only, so a cashier cannot see what the drawer should hold): for one outlet and one day. Should be in the drawer = cash at the start + cash sales + udhaar received in cash - cash refunds - cash expenses - cash paid to suppliers. UPI, card and credit are shown but not counted. The owner enters the cash counted and what was taken out (bank deposit or owner); Orvia shows short / extra / matched. **Cash left (counted minus taken out) is the next day's opening cash.** The first close of an outlet asks for the opening cash once. If days in between were not closed, the next close covers all of them. Days must be closed in order; closing a day again replaces its count and keeps the old one marked superseded. A count is a record: cancelling a cash expense later does not change it (the owner is told). API: `GET /cash/close?branchId&date`, `POST /cash/close`, `GET /cash/history`; audited as `cash.close`.
- **Which outlet's drawer?** Udhaar received and supplier payments now save the outlet picked in the top bar (`branchId`). Older entries and ones without an outlet count for a shop with **one** outlet; in a shop with several outlets they are not counted and the screen warns how many there are (that warning path is not covered by a test).
- Not built: cash from different cashiers or shifts counted separately, denominations (notes and coins) count, a printed Z-report, recurring expenses (monthly rent).

### 5.19 Stock count (physical stock take)
- **Stock count** in the shop sidebar (and a button on Inventory), `/retail/stock-count`, per outlet (the one in the top bar). **Counting** needs `inventory.adjust` (owner, manager, store keeper); **seeing the differences and applying them** needs `purchase.approve` (owner, manager), because the differences are stock value. One count at a time per outlet.
- **Flow:** start a count, then a list of every batch in stock (sorted by rack, then name) where the packs found (and loose units, for products sold loose) are entered; each row saves when it changes, a scanned barcode jumps to its medicine, the count can be left and resumed. "Finish counting" moves it to review; the reviewer sees what Orvia held against what was counted, per batch, valued at cost (short and extra), and the batches nobody counted. "Apply corrections" writes the differences; "Back to counting" reopens it; "Cancel" throws it away without touching stock.
- **Blind count:** while counting, the API never sends the stock Orvia holds (no quantity in the sheet), so the counter cannot copy the system number.
- **Bills made during the count are safe.** Each counted line remembers what the system held at that moment; the correction applied is (counted minus that), added to what the batch holds when applying. So a bill made after counting stays, and stock is never overwritten with an old number.
- **Applying** is one transaction: each difference is added to or taken off the batch and written to the append-only ledger (type ADJUST, reason COUNT_CORRECTION, reference = the count's name). If a shortage no longer fits (the batch has fewer units than the shortage because of bills since), nothing is applied and the owner is told to count that batch again. Batches nobody counted are **left unchanged** unless the owner ticks "write off the uncounted", then they are set to zero.
- API: `GET/POST /stock-counts`, `GET /stock-counts/:id/sheet`, `PUT /stock-counts/:id/lines`, `DELETE /stock-counts/:id/lines/:batchId`, `POST /stock-counts/:id/submit|reopen|cancel|apply`, `GET /stock-counts/:id/review`. Audited: `stockcount.start|submit|cancel|apply`.
- Not built: counting a batch that the system shows as zero (found stock: add it with "Found" in an adjustment first), counting by several people at once on one list, a printable count sheet, counting only one rack.

### 5.20 Cancelling a bill
- On a bill's page (Bills > open a bill), **Cancel this whole bill** (owner and managers, `purchase.approve`, like returns): for a bill made by mistake. It needs a reason and shows, before confirming, how the money goes back. API: `POST /sales/:id/cancel` (audited as `sale.cancel`).
- **What happens:** the whole bill's items go back into their batches (ledger rows of type RETURN with the reason BILL_CANCELLED); the bill gets status **CANCELLED** (with who, when, why) and **keeps its number** (numbers are never reused); the payment is refunded **the way it was paid**, one return per part of the payment: cash back from the drawer, card and own-QR UPI by hand (recorded), Razorpay UPI sent back to the customer's UPI (if Razorpay fails the bill is still cancelled and the refund can be retried from the bill, as with returns), udhaar taken off the customer's balance.
- **Because it is recorded as ordinary returns**, the daily sales report (billed minus refunds), GST summary, profit reports, customer statement and the **day's cash count** (cash refunds) all agree without special cases. A bill count in the dashboard, the daily report and a customer's bills/spend leaves cancelled bills out. A printed copy of a cancelled bill says BILL CANCELLED.
- **Rules:** a bill that already has any return cannot be cancelled (return the rest instead); only bills up to **7 days old** can be cancelled (older ones: take the items back with a return, so old tax periods are not disturbed); a cancelled bill cannot be returned or cancelled again.
- Not built: cancelling part of a bill (use a return), undoing a cancellation (make a new bill), a separate "cancelled bills" report (filter the Bills list by status is not built either; they show as "cancelled" in the list).

### 5.21 Activity ("who did what", for the shop owner)
- **Activity** (Accounts > Activity, `/retail/activity`, `GET /activity`): the shop's own audit trail in plain words, newest first: **when, who (name and role), what**. Filters: dates (default last 7 days), what (Bills, Stock, Purchases, Products, Money, Customers and staff, Settings, Sign-ins and security) and who (any member of staff). Paged, 50 per page.
- **Only the owner** (`user.manage`) sees it, because it shows what every member of staff did; managers, store keepers and cashiers get 403. It is read only: the audit log has no update or delete path, so nobody, the owner included, can change or remove an entry.
- **What is shown** is decided by a list in `modules/audit/activity.labels.js`: bills made, returned and cancelled; stock added, adjusted, moved, counted, imported; purchases and supplier payments; products added, changed, barcodes; expenses and day-close cash counts, udhaar received; customers and staff changes and reminders; shop and outlet changes, Razorpay keys; sign-ins (with the IP address) and 2-step changes. Ids inside events are turned into names (customer, supplier, product).
- **Orvia's own business is never shown**: plan changes, subscription invoices, medicine catalog work, platform users. **But Orvia support opening your shop** (`support.start` / `support.end`, with the reason) **and outlets that Orvia changed for you are shown**, marked "Orvia team", so the owner can always see when someone from Orvia looked at their data. Events of other shops never appear (the query is always for the signed-in shop).
- **Added with this feature** (they were not recorded before): stock received (`stock.entry`), products added from the catalog (`product.add`), own products created (`product.custom`) and product settings changed (`product.update`).
- Not built: events from before this existed are not backfilled; failed sign-in attempts are not shown to the owner (they have no shop attached); filtering by outlet; export to Excel; an email when something unusual happens.

### 5.22 Sending a bill on WhatsApp
- **Send on WhatsApp** on the bill page and on the "Bill saved" card after a sale (anyone who can bill). It opens WhatsApp (the person's own WhatsApp or WhatsApp Web) with a message already typed: greeting, shop name, bill number, date, amount, **a link to the bill**, and the shop's phone. Nothing is sent until they press send there. If the bill has no customer phone it asks for one (10 digits; +91 and spaces are removed); cancelling the question closes the window.
- **The link** (`/bill/<token>`, API `POST /sales/:id/share`) opens the bill as printed, to read, **Print or save as PDF**, on any phone, **with no sign-in**. The token is 32 random characters saved on the bill (`shareToken`); asking again gives the same link. Anyone who has the link can read that one bill (and only that), so it should be kept private; the page says so. It is served with `no-store` and `noindex`, rate limited to 120 requests per IP per 15 minutes, and a wrong or malformed token is a plain 404.
- **What the customer's page contains:** the bill, the shop and outlet details, the doctor and patient name on a Schedule H/H1 bill (as on the printed bill). **Never**: purchase cost, who made the bill, internal ids, the customer record. A cancelled bill opens and says it is cancelled.
- **Turning a link off** (`DELETE /sales/:id/share`, owner and managers; a "Turn the link off" line on a shared bill): the old address stops working at once, and sharing again makes a new address. The bill screen only knows that it is shared; the secret itself is never sent to staff screens.
- Sharing and turning off are in the audit log (`sale.share`, `sale.unshare`) and in the owner's Activity.
- **What this is not:** automatic sending from Orvia's own WhatsApp number (the WhatsApp Business Platform: needs Meta approval, a verified business number and approved message templates, and a cost per message). The WhatsApp link here costs nothing and works from the shop's own phone. `FRONTEND_URL` must be the public address of the web app in production, because it is the start of every link.
- Not built: sending to many customers at once, sending the PDF itself as a file, link expiry after some days, a count of how many times a link was opened.

### 5.23 Refill reminders (regular medicines)
- **Setting up:** on **Products > Edit**, a regular medicine (sugar, BP, thyroid ...) gets "Refill reminder: days one pack lasts" (`refillDays`, 0 = off, up to 365). Nothing else to enter at the counter.
- **Refills** (Operations > Refills, `/retail/refills`, `GET /refills`, anyone who bills): the customers whose supply is running out. For a customer's **last purchase** of such a medicine, the supply lasts `refillDays x packs bought` days (units returned are not counted; loose units count in proportion). It runs out on that date. The list shows who, which medicine, "runs out in 2 days" or "ran out 3 days ago", the bill it came from and when they were last reminded. Window: running out within 3/7/14/30 days and already out for up to 7/30/90 days (default 7 and 30), most urgent first.
- **Works on old bills too**, because the days are read from the product today (not copied onto each bill). Change the days and the list changes. The customer must be on the bill (a phone number on a bill makes the customer), otherwise there is no one to remind.
- **Not listed:** a customer who bought the medicine again (the newer purchase replaces the older), a purchase fully returned, a cancelled bill, an inactive customer, a medicine with 0 days, or one set aside with **Not needed** (`POST /refills/dismiss`; it comes back only after they buy it again).
- **Reminding:** **WhatsApp reminder** opens WhatsApp with the message typed (the shop's own WhatsApp; nothing is sent until they press send) and notes the customer as reminded; **Email reminder** sends a mail under the shop's name with the reply going to the person who pressed it (needs the customer's email; once a week per customer: 409 with the date otherwise); **Email reminder to all** (owner and managers: `purchase.approve`) emails everyone on the list who has an email and was not reminded this week, up to 200. Audited as `refill.reminder`, `refill.reminder.bulk`, `refill.dismiss` and shown in the owner's Activity.
- Not built: setting the days per bill at the counter (it is per product, per pack); a different dose for different customers; sending reminders automatically on a schedule; SMS; the customer replying "stop".

### 5.24 Purchase orders
- **Purchase orders** (Main menu, `/retail/purchase-orders`, `purchase.create`: owner, manager, store keeper): what the shop asks a supplier to send. A number per shop (`PO-000001`), a supplier, the outlet it is for, an optional "wanted by" date and note, and products with packs (and an optional expected rate). One line per product (the same product twice is added together). **From the Order list**, "Create purchase order" turns a supplier's ticked products into a draft in one click.
- **Status:** **Draft** (can be changed) then **Sent** then **Partly received** then **Received**; or **Closed (short)** or **Cancelled**. API: `GET/POST /purchase-orders`, `GET/PATCH /purchase-orders/:id`, `POST /:id/send|cancel|close`.
- **Sending** (once sent, an order is no longer editable, so what the supplier was told cannot change quietly: cancel and write a new one): **Send on WhatsApp** (opens WhatsApp on the supplier's number with the order typed; asks for a number if the supplier has none), **Email to supplier** (sent from here under the shop's name, replies to the sender; needs the supplier's email), **Print**. Each marks the order Sent and counts the times it was sent.
- **Receiving:** **Receive goods** on the order opens **New purchase** with the supplier, the outlet and the products still to come filled in; the person types the batch, expiry, MRP, rate and the packs that really came, and deletes lines that did not. Saving books the invoice **against the order** (`orderId` on the purchase) in the same transaction: each product's received packs (billed plus free) are added to the order's line, and the order becomes Partly received or Received. The invoice must be for the same supplier and outlet as the order and the order must be open. A product that was not on the order is booked as usual. The purchase shows "against order PO-...".
- **Closing:** **Cancel** an order that nothing came for (whoever wrote a draft can cancel it; a sent one only the owner or a manager). **Close as short supplied** (owner or manager) when part arrived and the rest is not coming; the reason is kept. Audited as `purchaseorder.create|update|send|cancel|close` and shown in the owner's Activity.
- Not built: approval before an order can be sent, prices checked against the supplier's invoice, a PDF file (only the print window), reminders for orders that are late, and receiving more than one invoice at once.

### 5.29 Email bounces and complaints (Amazon SES)

**Why:** SES judges the whole account by its bounce and complaint rate (review at about 5% and 0.1%, pause at 10% and 0.5%). Mailing the same dead or angry address again is what raises it. This is a platform matter (one SES account for every shop), so it lives in **Provider > Email**, not in the shop.

- **How SES tells us:** SES sends bounce and complaint notices to an **SNS topic**; the topic posts to `POST /api/v1/webhooks/ses` (HTTPS, no login). Both SES formats work (identity notifications and configuration-set events). Steps are written on the Email page: create the topic, point the SES identity's Bounce and Complaint notifications at it, subscribe the address (Orvia confirms the subscription by itself), put the topic ARN in `SES_SNS_TOPIC_ARN`, optionally a secret in `SES_WEBHOOK_TOKEN` (then add `?token=` to the address), and test with SES's mailbox simulator (`bounce@simulator.amazonses.com`, `complaint@simulator.amazonses.com`).
- **Trust:** every post must carry a valid Amazon signature (SHA-1 or SHA-256) whose certificate comes from an `https://sns.<region>.amazonaws.com` address; a changed message, another host, plain http, a look-alike host or another key is refused (403). Only the topic named in `SES_SNS_TOPIC_ARN` is accepted when it is set.
- **What happens:** a **permanent** bounce and any **complaint** put the address on the platform's **blocked list** (`EmailSuppression`). A passing bounce (full mailbox, busy server) is counted but not blocked. From then on `sendMail` does not send to that address: it logs "blocked (bounced before)" and gives the sender the reason, so a shop that tries to remind a bounced customer is told. (A sign-up with a blocked address is refused for the same reason.)
- **Email page:** delivery health for the last 30 days (sent, bounced for good with the rate, spam complaints with the rate, blocked addresses; status Healthy / Watch this / Too many; "Watch" from 2% or 0.05%, "Too many" from 5% or 0.1%, only meaningful after about 50 emails), the setup steps with the exact address, and the blocked list (search, block by hand, "Allow again" when the problem is fixed). Blocking and allowing are audited (`email.suppress`, `email.unsuppress`). Events are kept 180 days.
- **Tested:** against a signing key and certificate made for the test (real signature checks, all the refusals above, subscription confirmation, permanent and passing bounces, complaints in both formats, repeat bounces, the topic and secret guards, a suppressed address not being mailed while another still is tried) and the provider endpoints on a running server. **Not tested:** Amazon itself: a real SNS subscription and real SES notices need your AWS account (use the mailbox simulator after you set it up).
- **Not built:** automatic alert (email or WhatsApp) to you when the status turns to Watch; an unsubscribe link in reminder emails; blocking by domain; reading SES's own account-level suppression list.

### 5.28 Provider Settings, Terms of use and Privacy policy

**Settings** (Provider > Settings, `/provider/settings`, super admin only, `GET/PATCH /provider/settings`, audited as `settings.update`): company name, address, GSTIN and bank details (printed on subscription invoices), the GST rate on subscriptions, the days to pay after the due date, the free-trial days for self sign-up, the support email and phone, and the grievance officer's name and email. They are saved in the database, apply at once (kept in memory, refreshed after a save and every minute) and **win over the environment variables** of the same meaning (`COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_GSTIN`, `BANK_DETAILS`, `BILLING_GST_PERCENT`, `BILLING_GRACE_DAYS`, `SIGNUP_TRIAL_DAYS`, `MAIL_REPLY_TO` for the support email). An empty box uses the environment's value, so an install that never opens the page behaves as before. A new GST rate applies to invoices made from then on; old invoices keep their rate. Email server, payment keys, URLs and secrets stay in the environment on purpose.

**Terms of use and Privacy policy** are pages of the app itself (`/terms`, `/privacy`, no sign-in, the sign-up form links to them through `termsUrl` and `privacyUrl` in the environment files, now `/terms` and `/privacy`). The company name, address, support contact and grievance officer on them come from Settings (`GET /public/site`). The text is in `frontend/src/app/legal/legal-pages.ts`; change `LEGAL_UPDATED` there when you change it.

**The legal text is a plain-language draft written from what Orvia actually does, not legal advice. Have a lawyer read it before launch.** Points that are business decisions and are stated in it: no refund of fees already paid unless agreed in writing or required by law; view-only after the grace period; liability limited to the fees paid in the last 12 months; Indian law and courts; data kept for a reasonable time after an account ends so a copy can be asked for; data export or deletion is done by writing to support (there is no self-service export or delete yet).

### 5.27 GST filing: GSTR-1, GSTR-3B and e-invoice files

**Where:** Accounts > GST filing (`/retail/gst-filing`), needs `reports.view` and the plan feature `gstReports`. API under `/gst`. Orvia **does not file anything**: it works the figures out and gives the files; the owner or accountant checks them and uploads on the GST portal.

- **B2B and B2C.** A customer can have a **GSTIN** (checked: 15 characters, state code, and the check character), plus city and pincode. A bill to such a customer is **B2B** (`supplyType`, `buyerGstin`, `placeOfSupply` on the bill). If the customer's state (first two digits of the GSTIN) differs from the outlet's, the bill is **inter-state** and its tax is **IGST** (the printed bill shows IGST instead of CGST + SGST). Every other bill is B2C, in the shop's own state. The seller GSTIN is the outlet's, else the shop's (Settings).
- **GSTR-1** for one month (and one outlet, or all outlets when they share one GSTIN; different GSTINs must be filed one outlet at a time): B2B invoices by customer GSTIN, B2C summary (rate and state), credit notes to businesses, nil-rated, HSN summary (by HSN and rate, units "NOS") and documents issued. Downloads: **JSON** in the portal's offline layout, and a **CSV** of each table. Warnings are shown for a missing or invalid shop GSTIN and for medicines without an HSN code.
- **GSTR-3B** figures: tax on outward supplies (net of credit notes), nil-rated value, and **input tax credit** from the month's purchase invoices (by invoice date, less stock sent back). Credit is counted only for suppliers with a valid GSTIN; the rest is named in a warning. IGST or CGST + SGST follows the supplier's state against the shop's. Download: JSON. The final set-off is done on the portal.
- **Rules used:** a bill cancelled in the same month it was made is left out and counted as cancelled in "documents issued"; a return is a credit note in the month it was made (for a B2C bill it is taken off the B2C summary); tax at 0% is nil-rated.
- **E-invoice (IRP schema 1.1):** for a B2B bill (button "E-invoice file" on the bill, or all of a month's from the GST filing page) and for a B2B credit note: a JSON file for the e-invoice portal. Needs the shop GSTIN, outlet address, city and pincode, the customer's address, city and pincode, and an HSN of 4 to 8 digits on every item; what is missing is named in the message. The bill number must fit the portal's 16 characters.
- **Audit:** every export is logged (`gst.export`, `gst.einvoice`).
- **Tested:** with scripted checks on throwaway data (B2C, B2B in the same state, B2B in another state with IGST, a cancelled bill, returns on both kinds, purchases from suppliers in two states and one without a GSTIN): taxable + tax equals bills minus returns, the HSN table adds up to the same, 3B equals GSTR-1 and the credit splits as expected, the e-invoice items add up to the bill, and the page and downloads in the browser. **Not tested:** uploading any file to the real GST portal or the e-invoice portal (the layouts follow the published formats, but the portals may still reject a field), and no GSP or IRP account is connected, so no IRN or QR code is received or printed.
- **Not built:** sending the return or e-invoice to the portals directly (needs a GSP/IRP account), IRN and QR on the bill, GSTR-2B matching, reverse charge, sales to unregistered buyers across states above the portal limit (shown in B2C), amendments of an earlier month's invoices, quarterly (QRMP) invoice-furnishing layout, cess, and e-way bills.

### 5.26 Page title, description, keywords and share card

Static tags (title, description, keywords, canonical, Open Graph, X card, JSON-LD) are in `frontend/src/index.html`, because WhatsApp, Facebook and LinkedIn read only that file. The share image is `frontend/public/images/og-orvia.png` (1200x630), at `https://pharmacy.orviaerp.com/images/og-orvia.png`. `SeoService` then updates description, canonical and share tags for /login, /signup and /pricing, and marks every other page `noindex`. The site address is `siteUrl` in the environment files. After changing the image, social sites keep the old one cached until you refresh it in their debugger tools.

### 5.25 Free-trial sign-up and public pricing
- **`/signup`** (the sign-in page links to it: "New to Orvia? Start free trial") and **`/pricing`**, no sign-in needed. The visitor chooses a plan, gives the shop name, their name, mobile number, email and (optionally) city, and accepts the Terms and Privacy policy. A shop is created **at once** on a free trial of the chosen plan, with a Main Outlet; **a link to set the password is emailed to the owner** (valid 7 days). Everything after that is the normal shop: the trial, due, grace and lock flow of Billing applies.
- **Everything about the plans is dynamic.** The page reads `GET /public/plans` (cached for a minute; readable from the main website too, so the website can show the same prices). It lists the **active** plans that have "Show on the website's pricing and the free-trial sign-up page" ticked (Provider > Plans, also a one-line **tagline**), in the provider's sort order. Price, billing cycle, GST percent, limits (outlets, staff, products, bills a month), features and trial days are all read from the plan. Change a plan and the page changes; untick a plan and it disappears; an inactive plan is never offered. A plan link such as `/signup?plan=pro` (from a pricing button) pre-chooses that plan.
- **Trial length:** the plan's own "free trial (days)" if it has one, otherwise `SIGNUP_TRIAL_DAYS` (14) for a paid plan; a free plan (price 0 and no trial) has none and is simply active.
- **Safe by design:** the sign-in link is **only emailed, never returned to the browser**, so nobody can take over a shop by typing someone else's email. One trial per **email** and per **mobile number** (409 with a plain message). If the email cannot be sent (mail not set up, wrong address) the shop is **removed again** and the visitor is told to try again (503), so no unreachable shop is left behind. A hidden field catches simple bots (they get a "success" and nothing is made). Sign-ups are limited per IP per hour (`SIGNUP_RATE_LIMIT`, 429); this needs `TRUST_PROXY` behind a proxy. The shop records that it was made by sign-up (`signupSource: self`) and when the terms were accepted; the provider's audit log shows `tenant.signup` and the shop appears in Shops as usual.
- **Before launch:** have a lawyer read the Terms and Privacy pages (`/terms`, `/privacy`, built into the app, 5.28) and fill in Provider > Settings (company, support email, grievance officer); untick "Show on the website" for any plan that should not be offered (the old placeholder plan "Trial" is one: a plan named Trial that is free with a trial would otherwise be listed); check the email path end to end; consider a captcha (not built).
- **Look of the signed-out pages:** sign in, free trial, forgot password, set password and pricing all sit in one shared frame (`app/auth/auth-shell.ts`, styles in `app/auth/auth.css`, picture `public/images/medicine-cart.webp`): the form on the left, the picture and three selling points on the right, in the app theme (the colours are the theme variables, including the new `--field` and `--frame` in `themes/*.css`, so a new theme only needs to define those). The free-trial page also lists what the product does: eight headline points on the picture side, and a fold-out "What you get in every plan" (billing, stock, customers, money and control; only built features, kept in `INCLUDED` in `signup.ts`) above the form, open on a tablet or desktop and closed on a phone; what differs between plans (outlets, staff, barcode billing, UPI, GST reports) is shown on the plan cards from the plan list. Tablet in portrait: the picture becomes a short band above the form; phone: a compact band (no feature list) above the form.
- Not built: choosing or changing the plan from inside the shop (the provider changes it, the owner pays on the Billing page), asking for the drug licence at sign-up (it is entered later in Settings), a captcha, an approval step, the marketing landing page itself.

---

## 6. Data (MongoDB collections)

Tenant-scoped (every query is filtered by `tenantId` automatically; a query without a tenant throws): `Branch`, `Product`, `Batch`, `StockLedger` (append-only), `Supplier`, `Purchase`, `PurchaseReturn`, `SupplierPayment`, `Sale`, `SaleReturn`, `HeldBill`, `Customer`, `CustomerPayment`, `Expense`, `CashClose`, `StockCount`, `RefillDismissal`, `PurchaseOrder`, `OnlinePayment`, `PaymentSettings` (encrypted keys), `Counter` (bill, purchase and return numbers), `OutletRequest`, `MedicineRequest`.

Platform-level (not tenant-scoped; queries name the tenant explicitly): `Tenant` (status, plan, trial end, subscription period, extra outlets), `User` (platform staff have `tenantId = null`; 2FA fields), `Plan`, `Medicine` (the catalog), `Invoice` and `PlatformCounter` (subscription billing), `Invite` (password links, hashed), `AuditLog`, `EmailLog` (cleared after 90 days), `SupportSession`.

Money is stored in rupees as numbers rounded to 2 decimals; stock in units.

---

## 7. API (all under `/api/v1`)

Every route except `/auth/*` and `/webhooks/*` needs a token; then the tenant context is opened and, for shop users, the shop and user are re-checked.

| Group | Main routes |
|---|---|
| `/auth` | `login`, `login/2fa`, `forgot`, `refresh`, `me`, `invite/:token`, `invite/accept`, `2fa/status|setup|enable|disable|recovery-codes` |
| `/provider` | `tenants` (list, create, detail, edit, `suspend`, `activate`, `change-plan`, `reinvite`, `outlets`, `limits`), `plans`, `billing` (invoices, `run`, `tenants/:id/invoice|extend`, `invoices/:id/mark-paid|void`), `platform-users`, `email`, `audit-logs`, `medicines`, `medicine-requests`, `outlet-requests`, `dashboard/stats`, `tenants/:id/support-sessions` and `support/:sid/...` |
| `/branches`, `/users` | outlets (list, usage, add, edit, close, reopen, request more) and staff (add, edit, deactivate, reactivate, password link) |
| `/products` | `catalog`, `from-master`, `custom`, `:id` (settings), `:id/barcode` |
| `/stock` | `entries`, `adjustments`, `transfers`, `summary`, `batches`, `ledger` |
| `/suppliers`, `/purchases`, `/purchase-returns` | suppliers and statement, payments, invoices, returns |
| `/sales` | `search`, bills (create, list, detail), `holds`, `:id/returns`, `:id/returns/:rid/retry-refund`, `dashboard` |
| `/customers` | list, `search`, create, detail with statement, edit, `:id/payments` |
| `/reports/:name` | `sales`, `gst`, `items`, `register`, `expiry`, `lowstock`, `purchases`, `supplierwise`, `purchasegst`, `payables`, `receivables` |
| `/payments` | `upi/config`, `upi/orders`, `upi/verify`, `upi/qr` (+ status, close), `upi/unclaimed`, `settings` (shop's own keys) |
| `/billing` | `status` (any shop user), then owner only: overview, `invoices/:id`, `pay-order`, `verify` |
| `/support-access` | the owner's list of support sessions |
| `/webhooks/razorpay[/:tenantId]` | signed Razorpay callbacks, no login |

---

## 8. Security

- **Tenant isolation:** the Mongoose tenant plugin scopes every query, aggregate and save by the current tenant and refuses to run without one.
- **Sessions:** short access tokens (15 minutes) and refresh tokens; the server re-reads role, outlets, active status and shop status on every request. A password change ends older sessions at refresh. Sign-in, second step, forgot password and 2FA setup are rate-limited.
- **Orvia routes** are for platform users only; platform staff are re-checked on every request; 2FA is required for them in production.
- **Secrets at rest:** shops' payment keys and 2FA secrets are AES-256-GCM encrypted with a key that lives only in the environment; passwords are bcrypt; invite and reset tokens, and recovery codes, are stored hashed. Secrets are never returned by the API or written to the email log.
- **Money is never trusted from the browser:** payments are verified with Razorpay (signature, status, amount, one use), webhooks are signature-checked, bill amounts are recomputed on the server.
- **Append-only records:** stock ledger, audit log, customer and supplier payments.
- **Locked shops** (subscription ended) are read-only (HTTP 402) but can still pay; suspended shops cannot do anything.
- Helmet and CORS are on; the raw request body is kept only for the webhook route to verify signatures.

---

## 9. How it was tested

There is **no automated test suite in the repository yet**. Each feature was checked with scripted API runs and browser checks against **throwaway shops** (names starting with "E2E ..."), which were deleted by their exact name afterwards. Never clean a development database with a blanket delete: the demo shop holds real entered data. Checks covered, among others: transactions (a bill never exists without its stock movement), FEFO across batches, GST maths, limits and features on a purpose-made plan, the full billing life (trial, invoice, webhook payment, late payment, grace, lock, extension, reminders, void), 2FA (RFC 6238 test vector, replay, lock-out, reset), email against a local test mail server, refunds and webhooks, and role access (a cashier or accountant refused where expected).

**Not verified live (do these once before relying on them):**
- A **real** Razorpay payment and a **real** refund (only Razorpay's test account and simulated webhooks were used; production needs a Rs 1 trial).
- A **real** SMTP provider (a local test server was used).
- Printing from the browser (A4 bill, 80mm receipt, invoice) and CSV downloads were built but not clicked through.
- Mobile and tablet layouts were only glanced at.

---

## 10. Go-live checklist

**A. Must be done before the first real shop (none of these is code that can be tested here)**
1. **Env (`.env.production`):** strong `JWT_*` secrets, `MONGO_URI`, `CORS_ORIGIN`, `FRONTEND_URL` (the public web address: every customer bill link and invitation starts with it), `PUBLIC_API_URL`, `SETTINGS_ENCRYPTION_KEY` (and keep a safe copy: without it saved Razorpay keys and 2FA secrets cannot be read), live `RAZORPAY_*` keys, `RAZORPAY_WEBHOOK_SECRET`, `SMTP_*` and `MAIL_FROM`, `COMPANY_*`, `BANK_DETAILS`.
2. **HTTPS everywhere** for the web app and the API (sign-in tokens, bill links and Razorpay need it). Check the refresh cookie is `Secure` and `CORS_ORIGIN` is the exact web address.
3. **Razorpay dashboard:** webhook to `https://<your-api>/api/v1/webhooks/razorpay` with events `payment.captured`, `order.paid`, `qr_code.credited`, `refund.processed`, `refund.failed`; ask Razorpay to enable QR Codes on the live account.
4. **Email (Amazon SES):** in the SES console of the region you chose: verify the sending **domain** (Easy DKIM adds the DKIM records; add SPF and a DMARC record too), create the **SMTP credentials**, and **request production access** (a new SES account is in the *sandbox*: it only delivers to addresses you verified, with low limits). Then set the six mail variables, restart, and use Provider > Email > "Send test" to a Gmail and an Outlook address and check the spam folder. Set up bounce and complaint handling (an SNS topic that posts to `/api/v1/webhooks/ses`; the steps are on Provider > Email and in 5.29): a high bounce or complaint rate can get the SES account paused. Shops' own domains are never used as senders; their name is shown in front of `MAIL_FROM`. **Once email is configured, every action that sends mail (staff invites, resets, invoices, customer reminders, supplier orders) sends a real email, in development too.** Use a throwaway SMTP (or leave it empty) when running tests.
5. **Backups and monitoring:** MongoDB Atlas backups (and one test restore), error monitoring and an uptime alert. Not part of the code.
6. **First sign-in:** the super admin sets up 2FA straight away (required in production).
7. **Data:** review the catalog's schedule, GST and HSN (supplier-list rows are `pending` until verified); enter plan prices and limits on Plans.
8. **Frontend build:** `ng build` is the production build and uses `src/environments/environment.prod.ts` (API `https://apis.stuintern.in/api/v1`; set in `angular.json` as a file replacement), while `ng serve` uses `src/environments/environment.ts` (the local API on port 5000). The address is baked into the built files, so change it in `environment.prod.ts` and build again. Serve the built `dist/frontend/browser` with "any path that is not a file returns index.html" (otherwise a refresh on `/retail/...` or a customer's `/bill/<token>` link gives 404). **Our addresses:** web app `https://pharmacy.orviaerp.com`, API `https://apis.stuintern.in` (a different domain, so the browser makes cross-origin calls: sign-in tokens travel in the `Authorization` header, not cookies, so only CORS matters). API `.env.production`: `CORS_ORIGIN=https://pharmacy.orviaerp.com`, `FRONTEND_URL=https://pharmacy.orviaerp.com`, `PUBLIC_API_URL=https://apis.stuintern.in`, `TRUST_PROXY=1` behind one nginx. Razorpay webhook: `https://apis.stuintern.in/api/v1/webhooks/razorpay`. Shops see this API address on their Payments page as their webhook address, so they will see `stuintern.in`; point an address under your own domain (for example `api.pharmacy.orviaerp.com`) at the same server when you want that to read as Orvia, then change `apiUrl` and `PUBLIC_API_URL` and rebuild. Send SES mail from a verified `orviaerp.com` address (`MAIL_FROM=Orvia <no-reply@orviaerp.com>`), since that is the name customers know.
   **Production mode on your own computer:** API `cd backend && npm start` (NODE_ENV=production, reads `.env.production`; it is the real configuration: real email, live Razorpay keys, and whatever database `MONGO_URI` names, so check it first). Web app `cd frontend && ng serve --configuration local-prod --port 4300` (a minified, hashed production-style build that talks to `http://localhost:5000`; `environment.local-prod.ts`). Because the page is then on port 4300, start the API with `CORS_ORIGIN` including it (an exported variable beats the file), for example `CORS_ORIGIN=http://localhost:4300`. `ng serve --configuration production` uses the live API address instead.
9. **Run:** `npm start` with `NODE_ENV=production`; the billing job starts by itself.

**B. Try once, for real (these were only tested against fakes)**
- A Rs 1 UPI bill with a real QR, and its refund; a subscription invoice paid online; a Razorpay-paid bill cancelled.
- A forgot-password, a staff invitation, a udhaar reminder, a refill reminder and a purchase order to real inboxes.
- A printed bill on the shop's real printer (A4 and 80 mm), barcode labels on the real label roll, and a real barcode scanner.
- The POS on the shop's real phone and tablet, and a customer's WhatsApp bill link opened on a phone that is not signed in.
- A week of a real shop's data in a staging copy: import their Excel, bill, close the day, count stock.

**C. Before more than a handful of shops**
- Automated tests in the repository (none yet), a load test of billing and reports, a security review of the public bill link and the sign-in, terms of use and a privacy policy page (customer phone numbers and prescription details are personal data), a way to export or delete a shop's data.

---

## 11. Not built yet

- Automatic (scheduled) or SMS reminders for udhaar and refills; marking which bill a customer's payment settles (payments are per person); customer opt-out.
- A shop owner resetting a staff member's 2FA (ask Orvia to clear it); 2FA is optional for shop users. Per-shop custom roles (roles are fixed templates).
- Purchases: cancel or edit a booked invoice, approval before an order is sent, CGST/SGST/IGST split (sales and purchases use CGST+SGST only), a receiving outlet confirming a transfer.
- Billing: prorated mid-period upgrades, automatic renewal by card or UPI mandate (every renewal is paid by hand), credit notes, GST split by state.
- Email: an alert when delivery health worsens, and an unsubscribe link in reminders (bounce handling is built, see 5.29). Sending the bill itself as an email or a PDF file from Orvia's own WhatsApp number (the WhatsApp Business Platform).
- The `apiAccess` feature; sending GST returns and e-invoices to the portals directly (the files are built, see 5.27).
- Self-service plan change inside the shop; offline billing; camera barcode scanning in the browser; payment and customer panels on the phone POS as bottom sheets.
- Loyalty points, offers and discount schemes, doctor and patient history, home delivery orders, importing old bills and payment history.
- A shop owner's export of all their data, a data-retention and delete-shop process.
- Automated tests in the repository.

---

## 12. Decisions taken

- Payments: a gateway adapter pattern (Razorpay first); a shop can use its own keys so money goes to its own account, otherwise the platform account is the default. Subscription money always goes to the platform.
- Medicine master: one platform catalog, shops link to it; custom products are allowed immediately and approved later by a super admin.
- Multi-outlet: outlets inside a shop, staff tied to outlets, a switcher, transfers; the outlet limit comes from the plan plus provider-granted extras; only the owner adds outlets (the provider may on their behalf); compliance fields are optional.
- Email: any SMTP provider, configured by environment. Plans: Trial, Basic, Pro and Enterprise exist as editable placeholders (the prices are examples). Shop codes are generated from the shop name and can be edited when creating.
- Still yours to decide: the real plan names, prices and limits; where licensed medicine data comes from; whether free-trial shops should get barcode billing (the placeholder Trial plan has no features).
