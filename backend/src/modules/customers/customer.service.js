import mongoose from 'mongoose';
import { currentTenantId } from '../../plugins/tenantContext.js';
import { ApiError } from '../../utils/ApiError.js';
import { sendMail } from '../mail/mailer.js';
import { customerReminderMail } from '../mail/templates.js';
import { Tenant } from '../tenants/tenant.model.js';
import { User } from '../users/user.model.js';
import { Sale, SaleReturn } from '../sales/sale.model.js';
import { Customer, CustomerPayment, normalizePhone } from './customer.model.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oid = (id) => new mongoose.Types.ObjectId(id);

/**
 * What each customer owes: opening balance + udhaar given on bills - money received - udhaar cancelled by returns.
 * Returns a Map of customerId -> { owes, lastVisit, bills, spent }.
 */
export async function balances(customerIds) {
  const ids = customerIds.map(oid);
  const [credit, bills, paid, refunds, customers] = await Promise.all([
    Sale.aggregate([{ $match: { customerId: { $in: ids } } }, { $unwind: '$payments' }, { $match: { 'payments.mode': 'CREDIT' } }, { $group: { _id: '$customerId', v: { $sum: '$payments.amount' } } }]),
    Sale.aggregate([{ $match: { customerId: { $in: ids }, status: { $ne: 'CANCELLED' } } }, { $group: { _id: '$customerId', n: { $sum: 1 }, spent: { $sum: '$totals.grand' }, last: { $max: '$createdAt' } } }]),
    CustomerPayment.aggregate([{ $match: { customerId: { $in: ids } } }, { $group: { _id: '$customerId', v: { $sum: '$amount' } } }]),
    SaleReturn.aggregate([{ $match: { customerId: { $in: ids }, refundMode: 'CREDIT' } }, { $group: { _id: '$customerId', v: { $sum: '$refund' } } }]),
    Customer.find({ _id: { $in: ids } }).select('openingBalance').lean(),
  ]);
  const m = (rows) => new Map(rows.map((r) => [String(r._id), r]));
  const [c, b, p, rf] = [m(credit), m(bills), m(paid), m(refunds)];
  return new Map(
    customers.map((cu) => {
      const k = String(cu._id);
      const owes = r2((cu.openingBalance ?? 0) + (c.get(k)?.v ?? 0) - (p.get(k)?.v ?? 0) - (rf.get(k)?.v ?? 0));
      return [k, { owes, lastVisit: b.get(k)?.last ?? null, bills: b.get(k)?.n ?? 0, spent: r2(b.get(k)?.spent ?? 0) }];
    }),
  );
}

export async function balanceOf(customerId) {
  return (await balances([customerId])).get(String(customerId))?.owes ?? 0;
}

const view = (c, b) => ({
  _id: c._id,
  name: c.name,
  phone: c.phone ?? '',
  email: c.email ?? '',
  address: c.address ?? '',
  gstin: c.gstin ?? '',
  city: c.city ?? '',
  pincode: c.pincode ?? '',
  notes: c.notes ?? '',
  creditLimit: c.creditLimit ?? 0,
  openingBalance: c.openingBalance ?? 0,
  isActive: c.isActive,
  createdAt: c.createdAt,
  lastReminderAt: c.lastReminderAt ?? null,
  remindersSent: c.remindersSent ?? 0,
  owes: b?.owes ?? 0,
  bills: b?.bills ?? 0,
  spent: b?.spent ?? 0,
  lastVisit: b?.lastVisit ?? null,
});

export async function listCustomers({ q, filter, page = 1, limit = 20 }) {
  const f = {};
  if (q?.trim()) {
    const rx = new RegExp(esc(q.trim()), 'i');
    f.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }
  if (filter === 'active') f.isActive = true;
  const all = await Customer.find(f).sort({ name: 1 }).lean();
  const b = await balances(all.map((c) => c._id));
  let rows = all.map((c) => view(c, b.get(String(c._id))));
  if (filter === 'due') rows = rows.filter((r) => r.owes > 0.004).sort((x, y) => y.owes - x.owes);
  const totalDue = r2(rows.reduce((s, r) => s + Math.max(0, r.owes), 0));
  const remindable = rows.filter((r) => r.owes > 0.004 && r.isActive && r.email && canRemind(r.lastReminderAt)).length;
  const shop = await Tenant.findById(currentTenantId()).select('name phone').lean();
  return { items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit, totalDue, remindable, shopName: shop?.name ?? '' };
}

/** For the POS picker: a few matches by name or phone. */
export async function searchCustomers(q) {
  const text = q?.trim();
  if (!text) return [];
  const rx = new RegExp(esc(text), 'i');
  const found = await Customer.find({ isActive: true, $or: [{ name: rx }, { phone: rx }] }).sort({ name: 1 }).limit(8).lean();
  const b = await balances(found.map((c) => c._id));
  return found.map((c) => ({ _id: c._id, name: c.name, phone: c.phone ?? '', creditLimit: c.creditLimit ?? 0, owes: b.get(String(c._id))?.owes ?? 0 }));
}

export async function createCustomer(user, input) {
  const phone = input.phone ? normalizePhone(input.phone) : '';
  if (input.phone && !phone) throw ApiError.badRequest('The phone number must have 10 digits.');
  if (phone && (await Customer.exists({ phone }))) throw ApiError.conflict('A customer with this phone number already exists.');
  return Customer.create({ ...input, phone: phone || undefined, createdBy: user.id });
}

export async function updateCustomer(id, patch) {
  const c = await Customer.findById(id);
  if (!c) throw ApiError.notFound('Customer not found');
  if ('phone' in patch) {
    const phone = patch.phone ? normalizePhone(patch.phone) : '';
    if (patch.phone && !phone) throw ApiError.badRequest('The phone number must have 10 digits.');
    if (phone && phone !== c.phone && (await Customer.exists({ phone, _id: { $ne: c._id } }))) throw ApiError.conflict('Another customer already has this phone number.');
    patch.phone = phone || undefined;
  }
  Object.assign(c, patch);
  await c.save();
  return c;
}

/** The profile, what they owe, and a statement of every entry that moved the balance (oldest first, running total). */
export async function customerDetail(id) {
  const c = await Customer.findById(id).lean();
  if (!c) throw ApiError.notFound('Customer not found');
  const [credit, payments, refunds, b] = await Promise.all([
    Sale.find({ customerId: c._id, 'payments.mode': 'CREDIT' }).select('number createdAt payments').lean(),
    CustomerPayment.find({ customerId: c._id }).lean(),
    SaleReturn.find({ customerId: c._id, refundMode: 'CREDIT' }).select('number saleNumber createdAt refund').lean(),
    balances([c._id]),
  ]);
  const entries = [
    ...(c.openingBalance ? [{ kind: 'OPENING', id: 'opening', date: c.createdAt, at: 0, ref: 'Opening balance', amount: c.openingBalance }] : []),
    ...credit.map((s) => ({ kind: 'CREDIT_SALE', id: s._id, date: s.createdAt, at: +new Date(s.createdAt), ref: s.number, amount: r2(s.payments.filter((p) => p.mode === 'CREDIT').reduce((t, p) => t + p.amount, 0)) })),
    ...payments.map((p) => ({ kind: 'PAYMENT', id: p._id, date: p.receivedOn, at: +new Date(p.createdAt), ref: [p.mode, p.reference].filter(Boolean).join(' '), note: p.note, by: p.createdByName, amount: -p.amount })),
    ...refunds.map((r) => ({ kind: 'RETURN', id: r._id, date: r.createdAt, at: +new Date(r.createdAt), ref: `${r.number} (bill ${r.saleNumber})`, amount: -r.refund })),
  ].sort((x, y) => x.at - y.at); // in the order things happened (a payment's own date is only a day)
  let run = 0;
  for (const e of entries) {
    run = r2(run + e.amount);
    e.balance = run;
    delete e.at;
  }
  const shop = await Tenant.findById(currentTenantId()).select('name phone').lean();
  return { customer: view(c, b.get(String(c._id))), statement: entries, shop: { name: shop?.name ?? '', phone: shop?.phone ?? '' } };
}

export async function receivePayment(user, customerId, input, userName) {
  const c = await Customer.findById(customerId);
  if (!c) throw ApiError.notFound('Customer not found');
  const owes = await balanceOf(c._id);
  if (input.amount > owes + 0.009) throw ApiError.badRequest(`This customer owes ₹${Math.max(0, owes)}. You cannot receive more than that against udhaar.`);
  return CustomerPayment.create({
    customerId: c._id,
    amount: input.amount,
    receivedOn: new Date(`${input.receivedOn}T00:00:00.000Z`),
    mode: input.mode,
    reference: input.reference,
    note: input.note,
    branchId: input.branchId,
    createdBy: user.id,
    createdByName: userName,
  });
}

// ---------------------------------------------------------------- udhaar reminders
const REMIND_EVERY_DAYS = 3;
const canRemind = (last) => !last || Date.now() - new Date(last).getTime() >= REMIND_EVERY_DAYS * 24 * 60 * 60 * 1000;
const dateText = (d) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).format(new Date(d));

/** Emails one customer what they owe. A customer is reminded at most once every 3 days. Throws a plain-words reason if it cannot. */
export async function remindCustomer(user, customerId) {
  const c = await Customer.findById(customerId);
  if (!c) throw ApiError.notFound('Customer not found');
  if (!c.email) throw ApiError.badRequest('This customer has no email address. Add one, or remind on WhatsApp.');
  const owes = await balanceOf(c._id);
  if (owes <= 0.004) throw ApiError.badRequest('This customer owes nothing.');
  if (!canRemind(c.lastReminderAt)) {
    const next = new Date(new Date(c.lastReminderAt).getTime() + REMIND_EVERY_DAYS * 24 * 60 * 60 * 1000);
    throw ApiError.conflict(`A reminder was already sent on ${dateText(c.lastReminderAt)}. You can send another from ${dateText(next)}.`);
  }
  const [shop, sender] = await Promise.all([Tenant.findById(currentTenantId()).select('name phone address').lean(), User.findById(user.id).select('email').lean()]);
  const mail = customerReminderMail({ name: c.name, shopName: shop?.name ?? 'your pharmacy', amount: '₹' + owes.toLocaleString('en-IN', { maximumFractionDigits: 2 }), phone: shop?.phone, address: shop?.address });
  const r = await sendMail({ to: c.email, subject: mail.subject, text: mail.text, html: mail.html, template: 'customer-reminder', tenantId: currentTenantId(), fromName: shop?.name, replyTo: sender?.email });
  if (!r.sent) throw new ApiError(502, `The email could not be sent: ${r.error}`);
  c.lastReminderAt = new Date();
  c.remindersSent = (c.remindersSent ?? 0) + 1;
  await c.save();
  return { sentTo: c.email, owes };
}

/** Reminds everyone who owes money, has an email and has not been reminded in the last 3 days. At most 200 at a time. */
export async function remindAll(user) {
  const due = await listCustomers({ filter: 'due', page: 1, limit: 100000 });
  const out = { sent: 0, noEmail: 0, recent: 0, failed: 0, failures: [] };
  let tried = 0;
  for (const c of due.items) {
    if (!c.isActive) continue;
    if (!c.email) { out.noEmail++; continue; }
    if (!canRemind(c.lastReminderAt)) { out.recent++; continue; }
    if (tried >= 200) break;
    tried++;
    try {
      await remindCustomer(user, c._id);
      out.sent++;
    } catch (e) {
      out.failed++;
      if (out.failures.length < 3) out.failures.push(`${c.name}: ${e.message}`);
    }
  }
  return out;
}
