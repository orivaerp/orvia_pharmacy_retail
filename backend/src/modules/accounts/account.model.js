import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

const oid = mongoose.Schema.Types.ObjectId;

export const EXPENSE_CATEGORIES = ['Rent', 'Salary', 'Electricity and water', 'Transport', 'Packaging', 'Repairs and maintenance', 'Marketing', 'Licence and fees', 'Tea and misc', 'Other'];
export const EXPENSE_MODES = ['CASH', 'UPI', 'BANK', 'CHEQUE', 'OTHER'];

/** Money the shop spent to run (not stock). Never edited or deleted: a mistake is voided, with a reason, and stays on record. */
const expenseSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true }, // the day it was spent (a date, stored as midnight UTC)
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    mode: { type: String, enum: EXPENSE_MODES, default: 'CASH' },
    note: { type: String, trim: true },
    branchId: { type: oid, ref: 'Branch' }, // blank = the whole shop
    status: { type: String, enum: ['ACTIVE', 'VOID'], default: 'ACTIVE' },
    voidedAt: Date,
    voidReason: String,
    voidedByName: String,
    createdBy: { type: oid, ref: 'User' },
    createdByName: String,
  },
  { timestamps: true },
);
expenseSchema.plugin(tenantPlugin);
expenseSchema.index({ tenantId: 1, date: -1 });
export const Expense = mongoose.model('Expense', expenseSchema);

/**
 * The end-of-day cash count of one outlet. A close is never edited; closing the same day again replaces it
 * (the old one stays, marked superseded). `leftover` (counted minus what was taken out) is the next day's opening cash.
 */
const cashCloseSchema = new mongoose.Schema(
  {
    branchId: { type: oid, ref: 'Branch', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD, India time
    from: { type: String, required: true }, // first day the movements below cover (days since the last close)
    opening: { type: Number, required: true },
    cashSales: Number,
    cashRefunds: Number,
    cashReceived: Number, // udhaar collected in cash
    cashExpenses: Number,
    supplierCash: Number,
    expected: { type: Number, required: true },
    counted: { type: Number, required: true, min: 0 },
    difference: { type: Number, required: true }, // counted - expected (negative = short)
    withdrawn: { type: Number, default: 0, min: 0 },
    leftover: { type: Number, required: true },
    note: String,
    nonCash: { upi: Number, card: Number, credit: Number },
    closedBy: { type: oid, ref: 'User' },
    closedByName: String,
    supersededAt: Date,
  },
  { timestamps: true },
);
cashCloseSchema.plugin(tenantPlugin);
cashCloseSchema.index({ tenantId: 1, branchId: 1, date: -1 });
export const CashClose = mongoose.model('CashClose', cashCloseSchema);
