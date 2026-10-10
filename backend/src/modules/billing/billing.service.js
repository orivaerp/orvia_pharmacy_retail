import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { auditEvent } from '../audit/audit.model.js';
import { sendMail } from '../mail/mailer.js';
import { billingMail } from '../mail/templates.js';
import * as rzp from '../payments/razorpay.js';
import { getLimits } from '../plans/plan.service.js';
import { Tenant } from '../tenants/tenant.model.js';
import { User } from '../users/user.model.js';
import { WARN_DAYS, addCycle, billingState } from './billing.state.js';
import { Invoice, nextInvoiceNumber } from './invoice.model.js';

const DAY = 24 * 60 * 60 * 1000;
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (d) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d));
const billingUrl = () => `${env.FRONTEND_URL}/retail/billing`;

/** The company details printed on an invoice. */
export const companyInfo = () => ({ name: env.COMPANY_NAME, address: env.COMPANY_ADDRESS ?? '', gstin: env.COMPANY_GSTIN ?? '', bankDetails: env.BANK_DETAILS ?? '' });

async function ownerOf(tenant) {
  return tenant.ownerUserId ? User.findById(tenant.ownerUserId).select('name email').lean() : null;
}

async function emailOwner(tenant, mail, template) {
  const owner = await ownerOf(tenant);
  if (!owner) return false;
  return (await sendMail({ to: owner.email, subject: mail.subject, text: mail.text, html: mail.html, template, tenantId: tenant._id })).sent;
}

// ------------------------------------------------------------------ issuing
/** Issues the invoice for the period that starts at `periodStart`. Returns null if that period already has one. */
export async function issueInvoice(tenant, plan, { periodStart, now = new Date() }) {
  const amount = r2(plan.price);
  const gst = r2((amount * env.BILLING_GST_PERCENT) / 100);
  let invoice;
  try {
    invoice = await Invoice.create({
      number: await nextInvoiceNumber(now),
      tenantId: tenant._id,
      tenantName: tenant.name,
      planId: plan._id,
      planName: plan.name,
      cycle: plan.cycle,
      periodStart,
      periodEnd: addCycle(periodStart, plan.cycle),
      amount,
      gstPercent: env.BILLING_GST_PERCENT,
      gst,
      total: r2(amount + gst),
      issuedAt: now,
      dueDate: periodStart > now ? periodStart : new Date(now.getTime() + 3 * DAY),
    });
  } catch (e) {
    if (e?.code === 11000) return null; // already issued for this period
    throw e;
  }
  await auditEvent({ action: 'billing.invoice.issued', tenantId: tenant._id, meta: { number: invoice.number, total: invoice.total } });
  const owner = await ownerOf(tenant);
  await emailOwner(
    tenant,
    billingMail({ kind: 'issued', name: owner?.name ?? 'there', shopName: tenant.name, number: invoice.number, total: money(invoice.total), due: dateText(invoice.dueDate), url: billingUrl() }),
    'invoice-issued',
  );
  return invoice;
}

/**
 * The daily job (also runnable by hand): invoices shops whose period ends within a week, and reminds shops with an
 * unpaid invoice. Safe to run any number of times: an invoice is never issued twice for the same period.
 */
export async function runBillingCycle({ now = new Date() } = {}) {
  const out = { issued: 0, reminded: 0, started: 0 };
  const tenants = await Tenant.find({ status: { $in: ['trial', 'active'] } }).populate('planId');

  for (const t of tenants) {
    const plan = t.planId;
    if (!plan || plan.price <= 0) continue; // a free plan is never billed

    // a shop that was running before billing existed gets one full period free, then is billed normally
    if (t.status === 'active' && !t.subscription?.periodEnd && !t.subscription?.startedAt) {
      t.set('subscription.startedAt', now);
      t.set('subscription.periodEnd', addCycle(now, plan.cycle));
      await t.save();
      out.started++;
      continue;
    }
    const nextStart = t.status === 'trial' ? t.trialEndsAt : t.subscription?.periodEnd;
    if (!nextStart || nextStart.getTime() - now.getTime() > WARN_DAYS * DAY) continue;
    if (await Invoice.exists({ tenantId: t._id, periodStart: nextStart, status: { $in: ['issued', 'paid'] } })) continue;
    if (await issueInvoice(t, plan, { periodStart: nextStart, now })) out.issued++;
  }

  // reminders: from 3 days before the due date, at most one every 2 days, at most 6 in all
  const open = await Invoice.find({ status: 'issued', dueDate: { $lte: new Date(now.getTime() + 3 * DAY) }, remindersSent: { $lt: 6 } });
  for (const inv of open) {
    if (inv.lastReminderAt && now.getTime() - inv.lastReminderAt.getTime() < 2 * DAY) continue;
    const tenant = await Tenant.findById(inv.tenantId);
    if (!tenant || tenant.status === 'suspended') continue;
    const owner = await ownerOf(tenant);
    const overdue = inv.dueDate < now;
    await emailOwner(
      tenant,
      billingMail({ kind: overdue ? 'overdue' : 'reminder', name: owner?.name ?? 'there', shopName: tenant.name, number: inv.number, total: money(inv.total), due: dateText(inv.dueDate), url: billingUrl(), graceDays: env.BILLING_GRACE_DAYS }),
      overdue ? 'invoice-overdue' : 'invoice-reminder',
    );
    inv.remindersSent += 1;
    inv.lastReminderAt = now;
    await inv.save();
    out.reminded++;
  }
  return out;
}

// ------------------------------------------------------------------ paying
/**
 * Marks an invoice paid and gives the shop its period. Paid early: the new period starts when the old one ends.
 * Paid late: it starts now, so a shop never pays for days it could not use.
 */
export async function markPaid(invoiceId, { method, reference, razorpayPaymentId, paidOn, by, now = new Date() }) {
  const inv = await Invoice.findOneAndUpdate(
    { _id: invoiceId, status: 'issued' },
    { $set: { status: 'paid', paidAt: paidOn ?? now, method, reference, razorpayPaymentId, markedBy: by } },
    { new: true },
  );
  if (!inv) return null; // already paid, or voided
  const tenant = await Tenant.findById(inv.tenantId);
  if (tenant) {
    const base = new Date(Math.max(now.getTime(), inv.periodStart.getTime()));
    const end = addCycle(base, inv.cycle);
    await Invoice.updateOne({ _id: inv._id }, { $set: { periodStart: base, periodEnd: end } }).catch(() => undefined);
    tenant.status = 'active';
    tenant.trialEndsAt = null;
    tenant.set('subscription.periodEnd', end);
    tenant.set('subscription.graceUntil', null);
    if (!tenant.subscription?.startedAt) tenant.set('subscription.startedAt', now);
    await tenant.save();
    const owner = await ownerOf(tenant);
    await emailOwner(tenant, billingMail({ kind: 'paid', name: owner?.name ?? 'there', shopName: tenant.name, number: inv.number, total: money(inv.total), due: dateText(end), url: billingUrl() }), 'invoice-paid');
    inv.periodStart = base;
    inv.periodEnd = end;
  }
  await auditEvent({ actorId: by, action: 'billing.invoice.paid', tenantId: inv.tenantId, meta: { number: inv.number, method, total: inv.total } });
  return inv;
}

const platformKeys = () => {
  const creds = rzp.platformCreds();
  if (!creds) throw ApiError.badRequest('Online payment is not available yet. Pay by bank transfer and tell Orvia, who will mark the invoice paid.');
  return creds;
};

export async function startOnlinePayment(inv) {
  if (inv.status !== 'issued') throw ApiError.conflict('This invoice is not waiting for payment.');
  const creds = platformKeys();
  const order = await rzp.createOrder(creds, { amountPaise: Math.round(inv.total * 100), receipt: inv.number, notes: { invoice: String(inv._id), tenant: String(inv.tenantId) } });
  inv.razorpayOrderId = order.id;
  await inv.save();
  return { orderId: order.id, keyId: creds.keyId, amountPaise: Math.round(inv.total * 100), name: 'Orvia', description: `Invoice ${inv.number}` };
}

/** After Checkout: do not trust the browser, ask Razorpay what happened. */
export async function verifyOnlinePayment(inv, { orderId, paymentId, signature }) {
  const creds = platformKeys();
  if (!inv.razorpayOrderId || orderId !== inv.razorpayOrderId) throw ApiError.badRequest('This payment is for a different invoice.');
  if (!rzp.verifySignature(creds, orderId, paymentId, signature)) throw ApiError.badRequest('The payment could not be verified.');
  let p = await rzp.fetchPayment(creds, paymentId);
  if (p.order_id !== orderId) throw ApiError.badRequest('This payment belongs to a different order.');
  if (p.status === 'authorized') p = await rzp.capturePayment(creds, paymentId, p.amount);
  if (p.status !== 'captured') throw ApiError.badRequest('The payment was not completed.');
  if (p.amount !== Math.round(inv.total * 100)) throw ApiError.badRequest('The paid amount does not match the invoice.');
  return (await markPaid(inv._id, { method: 'razorpay', razorpayPaymentId: paymentId })) ?? (await Invoice.findById(inv._id));
}

// ------------------------------------------------------------------ what the screens need
/** The small status the banner shows to every user of a shop. */
export async function statusFor(tenantId) {
  const tenant = await Tenant.findById(tenantId).select('status trialEndsAt subscription');
  const bs = billingState(tenant);
  const due = await Invoice.findOne({ tenantId, status: 'issued' }).sort({ dueDate: 1 }).select('number total dueDate').lean();
  return { ...bs, due: due ? { number: due.number, total: due.total, dueDate: due.dueDate } : null };
}

export async function shopBilling(tenantId) {
  const tenant = await Tenant.findById(tenantId).populate('planId');
  const [limits, invoices] = await Promise.all([getLimits(tenantId), Invoice.find({ tenantId }).sort({ periodStart: -1 }).limit(36).lean()]);
  const plan = tenant.planId;
  return {
    plan: plan && { name: plan.name, price: plan.price, cycle: plan.cycle, features: plan.features },
    state: billingState(tenant),
    gstPercent: env.BILLING_GST_PERCENT,
    limits,
    invoices,
    canPayOnline: Boolean(rzp.platformCreds()),
    company: companyInfo(),
  };
}

export async function extendShop(tenantId, days, reason, by) {
  const t = await Tenant.findById(tenantId);
  if (!t) throw ApiError.notFound('Shop not found');
  const now = new Date();
  if (t.status === 'trial') {
    t.trialEndsAt = new Date(Math.max(t.trialEndsAt?.getTime() ?? 0, now.getTime()) + days * DAY);
  } else {
    t.set('subscription.graceUntil', new Date(Math.max(t.subscription?.graceUntil?.getTime() ?? 0, now.getTime()) + days * DAY));
  }
  await t.save();
  await auditEvent({ actorId: by, action: 'billing.extended', tenantId: t._id, meta: { days, reason } });
  return billingState(t);
}

/** Provider overview: money in and out, plus the invoice list. */
export async function providerOverview({ status, tenantId, page = 1, limit = 25 }) {
  const filter = {};
  if (status === 'overdue') Object.assign(filter, { status: 'issued', dueDate: { $lt: new Date() } });
  else if (status) filter.status = status;
  if (tenantId) filter.tenantId = tenantId;

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [items, total, outstanding, overdue, collected, tenants] = await Promise.all([
    Invoice.find(filter).sort({ issuedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Invoice.countDocuments(filter),
    Invoice.aggregate([{ $match: { status: 'issued' } }, { $group: { _id: null, v: { $sum: '$total' }, n: { $sum: 1 } } }]),
    Invoice.aggregate([{ $match: { status: 'issued', dueDate: { $lt: new Date() } } }, { $group: { _id: null, v: { $sum: '$total' }, n: { $sum: 1 } } }]),
    Invoice.aggregate([{ $match: { status: 'paid', paidAt: { $gte: monthStart } } }, { $group: { _id: null, v: { $sum: '$total' } } }]),
    Tenant.find({ status: 'active' }).populate('planId', 'price cycle').lean(),
  ]);
  const mrr = r2(tenants.reduce((s, t) => s + (t.planId ? (t.planId.cycle === 'yearly' ? t.planId.price / 12 : t.planId.price) : 0), 0));
  return {
    items,
    total,
    page,
    limit,
    summary: { mrr, outstanding: r2(outstanding[0]?.v ?? 0), outstandingCount: outstanding[0]?.n ?? 0, overdue: r2(overdue[0]?.v ?? 0), overdueCount: overdue[0]?.n ?? 0, collectedThisMonth: r2(collected[0]?.v ?? 0) },
  };
}
