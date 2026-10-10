import { env } from '../../config/env.js';
import { runBillingCycle } from './billing.service.js';

/**
 * Runs the billing cycle a minute after the server starts and then every 6 hours. It is safe to run on every
 * server of a group at once, because an invoice is never issued twice for the same period.
 * Turn it off with BILLING_JOBS=false (for example in a test server).
 */
export function startBillingJobs() {
  if (env.BILLING_JOBS === 'false') return;
  const run = () =>
    runBillingCycle()
      .then((r) => {
        if (r.issued || r.reminded || r.started) console.log('[billing]', JSON.stringify(r));
      })
      .catch((e) => console.error('[billing] cycle failed:', e?.message ?? e));
  setTimeout(run, 60_000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
