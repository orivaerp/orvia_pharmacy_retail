import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

const oid = mongoose.Schema.Types.ObjectId;

/** A shop's customer. The phone number is how repeat customers are recognised, so it is unique within a shop. */
const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true }, // 10 digits, no spaces
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    // a business customer: its GSTIN makes the bill a B2B invoice (GSTR-1 and e-invoice)
    gstin: { type: String, trim: true, uppercase: true },
    city: { type: String, trim: true },
    pincode: { type: String, trim: true },
    notes: { type: String, trim: true },
    // udhaar (credit): how much the customer may owe at most. 0 = no limit set.
    creditLimit: { type: Number, default: 0, min: 0 },
    // owed by the customer when the shop started using Orvia
    openingBalance: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    lastReminderAt: Date,
    remindersSent: { type: Number, default: 0 },
    lastRefillReminderAt: Date,
    refillRemindersSent: { type: Number, default: 0 },
    createdBy: { type: oid, ref: 'User' },
  },
  { timestamps: true },
);
customerSchema.plugin(tenantPlugin);
customerSchema.index({ tenantId: 1, phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
customerSchema.index({ tenantId: 1, name: 1 });
export const Customer = mongoose.model('Customer', customerSchema);

/** Money received from a customer against what they owe. Never edited or deleted: a mistake is fixed by a correcting entry. */
const paymentSchema = new mongoose.Schema(
  {
    customerId: { type: oid, ref: 'Customer', required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    receivedOn: { type: Date, required: true },
    mode: { type: String, enum: ['CASH', 'UPI', 'CARD', 'BANK', 'OTHER'], default: 'CASH' },
    reference: { type: String, trim: true },
    note: { type: String, trim: true },
    branchId: { type: oid, ref: 'Branch' },
    createdBy: { type: oid, ref: 'User' },
    createdByName: String,
  },
  { timestamps: true },
);
paymentSchema.plugin(tenantPlugin);
export const CustomerPayment = mongoose.model('CustomerPayment', paymentSchema);

/** Digits only, last 10; '' if it is not a 10-digit number. */
export const normalizePhone = (p) => {
  const d = String(p ?? '').replace(/[^0-9]/g, '').slice(-10);
  return d.length === 10 ? d : '';
};
