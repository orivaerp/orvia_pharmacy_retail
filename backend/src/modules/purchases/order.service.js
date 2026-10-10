import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { currentTenantId } from '../../plugins/tenantContext.js';
import { Branch } from '../branches/branch.model.js';
import { sendMail } from '../mail/mailer.js';
import { purchaseOrderMail } from '../mail/templates.js';
import { Product, toView } from '../products/product.model.js';
import { Tenant } from '../tenants/tenant.model.js';
import { User } from '../users/user.model.js';
import { PurchaseOrder } from './order.model.js';
import { Purchase, Supplier, nextNumber } from './purchase.model.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const OPEN = ['DRAFT', 'SENT', 'PARTIAL'];

async function load(id, session) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Purchase order not found');
  const q = PurchaseOrder.findById(id);
  if (session) q.session(session);
  const o = await q;
  if (!o) throw ApiError.notFound('Purchase order not found');
  return o;
}

/** Turns what the screen sent into order lines: products must exist and be active, one line per product, quantities whole packs. */
async function buildLines(input) {
  const merged = new Map();
  for (const l of input) {
    const cur = merged.get(l.productId);
    if (cur) cur.packs += l.packs;
    else merged.set(l.productId, { ...l });
  }
  const docs = await Product.find({ _id: { $in: [...merged.keys()] } }).populate('masterId');
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return [...merged.values()].map((l) => {
    const d = byId.get(l.productId);
    if (!d) throw ApiError.badRequest('One of the products no longer exists');
    if (!d.isActive) throw ApiError.badRequest(`"${toView(d).name}" is inactive. Activate it before ordering it.`);
    const v = toView(d);
    return { productId: d._id, name: v.name, manufacturer: v.manufacturer, packs: l.packs, rate: l.rate ?? undefined, receivedPacks: 0 };
  });
}

async function checkParties({ supplierId, branchId }) {
  const [supplier, branch] = await Promise.all([Supplier.findById(supplierId), Branch.findById(branchId)]);
  if (!supplier || !supplier.isActive) throw ApiError.badRequest('Choose an active supplier');
  if (!branch || !branch.isActive) throw ApiError.badRequest('Choose an active outlet');
  return { supplier, branch };
}

export async function createOrder(user, input) {
  const { supplier } = await checkParties(input);
  const lines = await buildLines(input.lines);
  const session = await mongoose.startSession();
  let order;
  try {
    await session.withTransaction(async () => {
      const number = await nextNumber(session, 'purchase-order', 'PO');
      [order] = await PurchaseOrder.create([{ number, supplierId: supplier._id, supplierName: supplier.name, branchId: input.branchId, lines, notes: input.notes, expectedOn: input.expectedOn, createdBy: user.id, createdByName: user.name }], { session });
    });
  } finally {
    await session.endSession();
  }
  return order;
}

/** Only a draft can be edited: once it has gone to the supplier, what they were told must not change quietly. */
export async function updateOrder(id, input) {
  const o = await load(id);
  if (o.status !== 'DRAFT') throw ApiError.conflict('Only a draft order can be changed. Once it is sent, cancel it and make a new one.');
  const { supplier } = await checkParties({ supplierId: input.supplierId ?? o.supplierId, branchId: input.branchId ?? o.branchId });
  if (input.lines) o.lines = await buildLines(input.lines);
  o.supplierId = supplier._id;
  o.supplierName = supplier.name;
  if (input.branchId) o.branchId = input.branchId;
  if ('notes' in input) o.notes = input.notes;
  if ('expectedOn' in input) o.expectedOn = input.expectedOn;
  await o.save();
  return o;
}

const estimate = (o) => r2(o.lines.reduce((s, l) => s + (l.rate ?? 0) * l.packs, 0));
const pending = (o) => o.lines.reduce((s, l) => s + Math.max(0, l.packs - l.receivedPacks), 0);

const summary = (o) => ({
  _id: o._id,
  number: o.number,
  supplierId: o.supplierId,
  supplierName: o.supplierName,
  branchId: o.branchId,
  status: o.status,
  items: o.lines.length,
  packs: o.lines.reduce((s, l) => s + l.packs, 0),
  pendingPacks: pending(o),
  estimate: estimate(o),
  expectedOn: o.expectedOn,
  createdAt: o.createdAt,
  createdByName: o.createdByName,
  sentAt: o.sentAt,
});

export async function listOrders({ status, supplierId, branchId, branchIds, q, page = 1, limit = 20 }) {
  const filter = {};
  if (status === 'open') filter.status = { $in: OPEN };
  else if (status === 'done') filter.status = { $in: ['CLOSED', 'CANCELLED'] };
  else if (status) filter.status = status;
  if (supplierId) filter.supplierId = supplierId;
  if (branchId) filter.branchId = branchId;
  else if (branchIds?.length) filter.branchId = { $in: branchIds };
  if (q?.trim()) {
    const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ number: rx }, { supplierName: rx }, { 'lines.name': rx }];
  }
  const [items, total] = await Promise.all([PurchaseOrder.find(filter).populate('branchId', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), PurchaseOrder.countDocuments(filter)]);
  return { items: items.map((o) => ({ ...summary(o), branchId: o.branchId?._id ?? o.branchId, branchName: o.branchId?.name })), total, page, limit };
}

/** One order with, for each line, the product as the screens use it (so "receive" can fill the purchase form), and the invoices booked against it. */
export async function getOrder(id) {
  const o = await load(id);
  const [products, purchases, supplier, branch] = await Promise.all([
    Product.find({ _id: { $in: o.lines.map((l) => l.productId) } }).populate('masterId'),
    Purchase.find({ _id: { $in: o.purchaseIds } }).select('number invoiceNo invoiceDate totals').sort({ invoiceDate: 1 }).lean(),
    Supplier.findById(o.supplierId).select('name phone email contactPerson').lean(),
    Branch.findById(o.branchId).select('name').lean(),
  ]);
  const view = new Map(products.map((p) => [String(p._id), toView(p)]));
  return {
    ...summary(o),
    notes: o.notes,
    sentVia: o.sentVia,
    sentCount: o.sentCount,
    closedAt: o.closedAt,
    closeReason: o.closeReason,
    closedByName: o.closedByName,
    supplier,
    branchName: branch?.name,
    lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, manufacturer: l.manufacturer, packs: l.packs, rate: l.rate ?? null, receivedPacks: l.receivedPacks, pendingPacks: Math.max(0, l.packs - l.receivedPacks), product: view.get(String(l.productId)) ?? null })),
    purchases,
  };
}

/** Marks the order as given to the supplier. By email it is sent from here; for WhatsApp and print the shop sends it themselves. */
export async function sendOrder(user, id, via) {
  const o = await load(id);
  if (!OPEN.includes(o.status)) throw ApiError.conflict('This order is already finished, so it cannot be sent');
  if (via === 'email') {
    const [supplier, shop, sender, branch] = await Promise.all([
      Supplier.findById(o.supplierId).select('name email contactPerson').lean(),
      Tenant.findById(currentTenantId()).select('name phone address').lean(),
      User.findById(user.id).select('email').lean(),
      Branch.findById(o.branchId).select('name address city').lean(),
    ]);
    if (!supplier?.email) throw ApiError.badRequest('This supplier has no email address. Add one under Suppliers, or send the order on WhatsApp.');
    const mail = purchaseOrderMail({
      number: o.number,
      supplierName: supplier.contactPerson || supplier.name,
      shopName: shop?.name ?? 'our pharmacy',
      outlet: branch?.name,
      deliverTo: [branch?.address, branch?.city].filter(Boolean).join(', ') || shop?.address,
      phone: shop?.phone,
      expectedOn: o.expectedOn,
      notes: o.notes,
      lines: o.lines.map((l) => ({ name: l.name, manufacturer: l.manufacturer, packs: l.packs })),
    });
    const r = await sendMail({ to: supplier.email, subject: mail.subject, text: mail.text, html: mail.html, template: 'purchase-order', tenantId: currentTenantId(), fromName: shop?.name, replyTo: sender?.email });
    if (!r.sent) throw new ApiError(502, `The email could not be sent: ${r.error}`);
  }
  if (o.status === 'DRAFT') o.status = 'SENT';
  o.sentAt = new Date();
  o.sentVia = via;
  o.sentCount = (o.sentCount ?? 0) + 1;
  await o.save();
  return summary(o);
}

/** An order that nothing has arrived for. (A draft can be cancelled by whoever wrote it; a sent one needs an owner or manager.) */
export async function cancelOrder(user, id, reason, { canCancelSent }) {
  const o = await load(id);
  if (o.lines.some((l) => l.receivedPacks > 0)) throw ApiError.conflict('Some of this order has already arrived. Close the order instead.');
  if (!['DRAFT', 'SENT'].includes(o.status)) throw ApiError.conflict('This order is already finished');
  if (o.status === 'SENT' && !canCancelSent) throw ApiError.forbidden('Only the owner or a manager can cancel an order that was already sent');
  o.status = 'CANCELLED';
  o.closedAt = new Date();
  o.closeReason = reason;
  o.closedByName = user.name;
  await o.save();
  return summary(o);
}

/** Short supply: part of it arrived and the rest is not coming. */
export async function closeOrder(user, id, reason) {
  const o = await load(id);
  if (o.status !== 'PARTIAL') throw ApiError.conflict('Only an order that is partly received can be closed. Cancel it if nothing arrived.');
  o.status = 'CLOSED';
  o.closedAt = new Date();
  o.closeReason = reason;
  o.closedByName = user.name;
  await o.save();
  return summary(o);
}

/** Before a purchase is booked against an order: it must be open, the same supplier and the same outlet. */
export async function checkReceivable(orderId, { supplierId, branchId }) {
  const o = await load(orderId);
  if (!OPEN.includes(o.status)) throw ApiError.conflict(`Order ${o.number} is ${o.status.toLowerCase()}, so goods cannot be received against it`);
  if (String(o.supplierId) !== String(supplierId)) throw ApiError.badRequest(`Order ${o.number} is for ${o.supplierName}, not this supplier`);
  if (String(o.branchId) !== String(branchId)) throw ApiError.badRequest(`Order ${o.number} is for a different outlet`);
  return o;
}

/** Inside the purchase's transaction: what arrived (billed plus free packs) is counted against the order's lines. */
export async function applyReceipt(session, orderId, purchaseId, received) {
  const o = await load(orderId, session);
  for (const r of received) {
    const line = o.lines.find((l) => String(l.productId) === String(r.productId));
    if (line) line.receivedPacks += r.packs; // a product that was not on the order is simply booked as usual
  }
  o.purchaseIds.push(purchaseId);
  o.status = o.lines.every((l) => l.receivedPacks >= l.packs) ? 'RECEIVED' : 'PARTIAL';
  await o.save({ session });
  return o;
}
