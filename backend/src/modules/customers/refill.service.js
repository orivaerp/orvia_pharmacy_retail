import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { currentTenantId } from '../../plugins/tenantContext.js';
import { customerRefillMail } from '../mail/templates.js';
import { sendMail } from '../mail/mailer.js';
import { Sale } from '../sales/sale.model.js';
import { Tenant } from '../tenants/tenant.model.js';
import { User } from '../users/user.model.js';
import { Customer } from './customer.model.js';
import { RefillDismissal } from './refill.model.js';

export const REMIND_EVERY_DAYS = 7;
const DAY = 86_400_000;
const oid = (id) => new mongoose.Types.ObjectId(id);
const dateText = (d) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).format(new Date(d));
const canRemind = (last) => !last || Date.now() - new Date(last).getTime() >= REMIND_EVERY_DAYS * DAY;

/**
 * Customers whose regular medicines are about to run out (or just did).
 * A medicine is a "refill medicine" when the owner sets how many days one pack lasts (product.refillDays). From a customer's LAST purchase of it,
 * the supply lasts refillDays x packs bought (units returned do not count), so it runs out on that date. A newer purchase replaces the older one,
 * so a customer who already refilled is not listed. Works on past bills too, because the days are read from the product today.
 */
export async function refillList({ ahead = 7, late = 30, branchScope } = {}) {
  const now = Date.now();
  const from = new Date(now - late * DAY);
  const to = new Date(now + ahead * DAY);
  const rows = await Sale.aggregate([
    { $match: { customerId: { $ne: null }, status: { $ne: 'CANCELLED' }, createdAt: { $gte: new Date(now - (late + 400) * DAY) }, ...(branchScope?.length && { branchId: { $in: branchScope.map(oid) } }) } },
    { $unwind: '$lines' },
    { $addFields: { keptUnits: { $subtract: ['$lines.units', '$lines.returnedUnits'] } } },
    { $match: { keptUnits: { $gt: 0 } } },
    { $lookup: { from: 'products', localField: 'lines.productId', foreignField: '_id', as: 'p', pipeline: [{ $project: { refillDays: 1 } }] } },
    { $addFields: { refillDays: { $ifNull: [{ $arrayElemAt: ['$p.refillDays', 0] }, 0] } } },
    { $match: { refillDays: { $gt: 0 } } },
    { $addFields: { packs: { $divide: ['$keptUnits', { $ifNull: ['$lines.unitsPerPack', 1] }] } } },
    { $addFields: { due: { $add: ['$createdAt', { $multiply: [{ $round: [{ $multiply: ['$refillDays', '$packs'] }, 0] }, DAY] }] } } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: { c: '$customerId', p: '$lines.productId' }, name: { $last: '$lines.name' }, due: { $last: '$due' }, boughtOn: { $last: '$createdAt' }, sale: { $last: '$number' } } },
    { $match: { due: { $gte: from, $lte: to } } },
    { $limit: 5000 },
  ]);
  if (!rows.length) return [];

  const [customers, dismissed] = await Promise.all([
    Customer.find({ _id: { $in: [...new Set(rows.map((r) => String(r._id.c)))] }, isActive: true }).select('name phone email lastRefillReminderAt').lean(),
    RefillDismissal.find({ customerId: { $in: rows.map((r) => r._id.c) } }).lean(),
  ]);
  const byCustomer = new Map(customers.map((c) => [String(c._id), c]));
  const gone = new Set(dismissed.map((d) => `${d.customerId}|${d.productId}|${new Date(d.boughtOn).getTime()}`));

  const out = new Map();
  for (const r of rows) {
    const c = byCustomer.get(String(r._id.c));
    if (!c || gone.has(`${r._id.c}|${r._id.p}|${new Date(r.boughtOn).getTime()}`)) continue;
    if (!out.has(String(c._id))) out.set(String(c._id), { customerId: c._id, name: c.name, phone: c.phone ?? '', email: c.email ?? '', lastRemindedAt: c.lastRefillReminderAt ?? null, canEmail: Boolean(c.email) && canRemind(c.lastRefillReminderAt), items: [] });
    out.get(String(c._id)).items.push({ productId: r._id.p, name: r.name, due: r.due, boughtOn: r.boughtOn, bill: r.sale, daysLeft: Math.ceil((new Date(r.due).getTime() - now) / DAY) });
  }
  const list = [...out.values()];
  for (const c of list) c.items.sort((a, b) => a.daysLeft - b.daysLeft);
  return list.sort((a, b) => a.items[0].daysLeft - b.items[0].daysLeft || a.name.localeCompare(b.name));
}

/** Sets aside one medicine of one customer's last purchase ("they buy it elsewhere / stopped it"): it is not listed again until they buy it again. */
export async function dismiss({ customerId, productId, boughtOn }, userId) {
  const when = new Date(boughtOn);
  if (Number.isNaN(when.getTime())) throw ApiError.badRequest('Invalid purchase date');
  if (!(await Customer.exists({ _id: customerId }))) throw ApiError.notFound('Customer not found');
  await RefillDismissal.updateOne({ customerId, productId, boughtOn: when }, { $setOnInsert: { createdBy: userId } }, { upsert: true });
}

/** Notes that the customer was reminded (WhatsApp is opened by the owner themselves, so only the note is saved), or emails them. */
export async function remind(user, customerId, channel, opts = {}) {
  const c = await Customer.findById(customerId);
  if (!c) throw ApiError.notFound('Customer not found');
  const list = (opts.list ?? (await refillList({}))).find((x) => String(x.customerId) === String(c._id));
  if (!list) throw ApiError.badRequest('This customer has no medicine due for a refill right now.');
  if (channel === 'whatsapp') {
    c.lastRefillReminderAt = new Date();
    c.refillRemindersSent = (c.refillRemindersSent ?? 0) + 1;
    await c.save();
    return { channel, items: list.items.length };
  }
  if (!c.email) throw ApiError.badRequest('This customer has no email address. Add one, or remind on WhatsApp.');
  if (!canRemind(c.lastRefillReminderAt)) {
    const next = new Date(new Date(c.lastRefillReminderAt).getTime() + REMIND_EVERY_DAYS * DAY);
    throw ApiError.conflict(`A refill reminder was already sent on ${dateText(c.lastRefillReminderAt)}. You can send another from ${dateText(next)}.`);
  }
  const [shop, sender] = await Promise.all([Tenant.findById(currentTenantId()).select('name phone address').lean(), User.findById(user.id).select('email').lean()]);
  const mail = customerRefillMail({ name: c.name, shopName: shop?.name ?? 'your pharmacy', items: list.items.map((i) => ({ name: i.name, daysLeft: i.daysLeft, due: dateText(i.due) })), phone: shop?.phone, address: shop?.address });
  const r = await sendMail({ to: c.email, subject: mail.subject, text: mail.text, html: mail.html, template: 'refill-reminder', tenantId: currentTenantId(), fromName: shop?.name, replyTo: sender?.email });
  if (!r.sent) throw new ApiError(502, `The email could not be sent: ${r.error}`);
  c.lastRefillReminderAt = new Date();
  c.refillRemindersSent = (c.refillRemindersSent ?? 0) + 1;
  await c.save();
  return { channel, sentTo: c.email, items: list.items.length };
}

/** Emails everyone on the list who has an email and has not been reminded in the last 7 days (at most 200). */
export async function remindAll(user, opts) {
  const list = await refillList(opts);
  const out = { sent: 0, noEmail: 0, recent: 0, failed: 0, failures: [] };
  let tried = 0;
  for (const c of list) {
    if (!c.email) { out.noEmail++; continue; }
    if (!c.canEmail) { out.recent++; continue; }
    if (tried >= 200) break;
    tried++;
    try {
      await remind(user, c.customerId, 'email', { list });
      out.sent++;
    } catch (e) {
      out.failed++;
      if (out.failures.length < 3) out.failures.push(`${c.name}: ${e.message}`);
    }
  }
  return out;
}

export async function shopInfo() {
  const shop = await Tenant.findById(currentTenantId()).select('name phone').lean();
  return { shopName: shop?.name ?? '', shopPhone: shop?.phone ?? '' };
}

