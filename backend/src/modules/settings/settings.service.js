import mongoose from 'mongoose';
import { env } from '../../config/env.js';

/**
 * Platform settings the Orvia team can change from Provider > Settings, without touching the server.
 * What is saved here wins; anything left empty falls back to the environment variable of the same meaning (so an existing install keeps working).
 * The values are read all the time (billing, sign-up, the legal pages), so they are kept in memory and refreshed after a save and once a minute.
 */
const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    companyName: String,
    companyAddress: String,
    companyGstin: String,
    bankDetails: String,
    companyPan: String,
    companyPhone: String,
    companyEmail: String,
    companyWebsite: String,
    companyLogo: String,
    invoiceNote: String,
    invoiceTerms: String,
    invoiceLayout: String,
    invoiceAccent: String,
    billingGstPercent: Number,
    billingGraceDays: Number,
    signupTrialDays: Number,
    supportEmail: String,
    supportPhone: String,
    grievanceName: String,
    grievanceEmail: String,
    updatedBy: String,
  },
  { timestamps: true },
);
const Settings = mongoose.model('PlatformSettings', schema);

export const FIELDS = ['companyName', 'companyAddress', 'companyGstin', 'bankDetails', 'companyPan', 'companyPhone', 'companyEmail', 'companyWebsite', 'companyLogo', 'invoiceNote', 'invoiceTerms', 'invoiceLayout', 'invoiceAccent', 'billingGstPercent', 'billingGraceDays', 'signupTrialDays', 'supportEmail', 'supportPhone', 'grievanceName', 'grievanceEmail'];

const fromEnv = () => ({
  companyName: env.COMPANY_NAME,
  companyAddress: env.COMPANY_ADDRESS ?? '',
  companyGstin: env.COMPANY_GSTIN ?? '',
  bankDetails: env.BANK_DETAILS ?? '',
  companyPan: '',
  companyPhone: '',
  companyEmail: '',
  companyWebsite: '',
  companyLogo: '',
  invoiceNote: 'This is a computer-generated invoice.',
  invoiceTerms: '',
  invoiceLayout: 'classic',
  invoiceAccent: '#0b3d3a',
  billingGstPercent: env.BILLING_GST_PERCENT,
  billingGraceDays: env.BILLING_GRACE_DAYS,
  signupTrialDays: env.SIGNUP_TRIAL_DAYS,
  supportEmail: env.MAIL_REPLY_TO ?? '',
  supportPhone: '',
  grievanceName: '',
  grievanceEmail: '',
});

let saved = {};
let current = fromEnv();

const merge = () => {
  const out = fromEnv();
  for (const k of FIELDS) if (saved[k] !== undefined && saved[k] !== null && saved[k] !== '') out[k] = saved[k];
  current = out;
};

/** The settings in force right now (saved value, else the environment's). Cheap: read it whenever needed. */
export const settings = () => current;

/** What is saved (empty where the environment's value is used), for the settings screen. */
export const savedSettings = () => ({ ...Object.fromEntries(FIELDS.map((k) => [k, saved[k] ?? ''])) });
export const envDefaults = fromEnv;

export async function loadSettings() {
  const doc = await Settings.findOne({ key: 'platform' }).lean();
  saved = doc ?? {};
  merge();
}

/** An empty string or null clears a value (the environment's value is used again). */
export async function saveSettings(patch, by) {
  const set = {};
  for (const k of FIELDS) if (k in patch) set[k] = patch[k] === '' ? null : patch[k];
  await Settings.updateOne({ key: 'platform' }, { $set: { ...set, updatedBy: by }, $setOnInsert: { key: 'platform' } }, { upsert: true });
  await loadSettings();
}

export function startSettingsRefresh() {
  setInterval(() => loadSettings().catch(() => undefined), 60_000).unref();
}
