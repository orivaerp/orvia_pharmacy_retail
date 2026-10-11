import dotenv from 'dotenv';
import { z } from 'zod';

// Loads .env.development / .env.production based on NODE_ENV (defaults to development).
// Variables already set in the real environment (e.g. hosting dashboard) take precedence.
const nodeEnv = process.env.NODE_ENV ?? 'development';
dotenv.config({ path: `.env.${nodeEnv}`, quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required (MongoDB Atlas connection string)'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:4200'),
  // used to build links sent to users (invites)
  FRONTEND_URL: z.string().default('http://localhost:4200'),
  // UPI collection through Razorpay (optional: without keys the UPI mode is only recorded, not collected)
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  // secret for the platform-level webhook (/api/v1/webhooks/razorpay); shops with their own keys save their own
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // 64 hex characters; encrypts shops' saved payment keys. Keep it safe: without it saved keys cannot be read.
  SETTINGS_ENCRYPTION_KEY: z.string().optional(),
  // public address of this API, shown to shops as their webhook URL
  // Orvia staff must use two-step verification (default: on in production, off in development)
  // Email over SMTP (any provider). Without SMTP_HOST and MAIL_FROM nothing is emailed; links are still shown on screen.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(), // e.g. Orvia <no-reply@yourdomain.com>
  // the same settings under the names some hosts use: login, password and sender display name
  EMAIL_USER: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  EMAIL_FROM_NAME: z.string().optional(),
  // Subscription billing
  COMPANY_NAME: z.string().default('Orvia'),
  COMPANY_ADDRESS: z.string().optional(),
  COMPANY_GSTIN: z.string().optional(),
  BANK_DETAILS: z.string().optional(), // shown on invoices for bank transfer, e.g. "A/C 1234, IFSC ABCD0001, Orvia"
  BILLING_GST_PERCENT: z.coerce.number().min(0).max(40).default(18),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(60).default(7),
  BILLING_JOBS: z.enum(['true', 'false']).optional(),
  // sign-in attempts allowed per IP per 15 minutes
  // how many reverse proxies sit in front of the API (0 when it is reached directly; 1 behind one nginx)
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(5).default(20),
  // self sign-up: trial length for a paid plan that has none of its own, and how many sign-ups one address may make an hour
  SIGNUP_TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  SIGNUP_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  REQUIRE_PLATFORM_2FA: z.enum(['true', 'false']).optional(),
  PUBLIC_API_URL: z.string().default('http://localhost:5000'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
