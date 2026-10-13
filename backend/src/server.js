import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { startBillingJobs } from './modules/billing/billing.jobs.js';
import { loadSettings, startSettingsRefresh } from './modules/settings/settings.service.js';

await connectDB();
await loadSettings();
startSettingsRefresh();

const server = createApp().listen(env.PORT, () => {
  console.log(`Orvia API listening on http://localhost:${env.PORT}/api/v1 (${env.NODE_ENV})`);
});

startBillingJobs();

const shutdown = async () => {
  server.close();
  await disconnectDB();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
