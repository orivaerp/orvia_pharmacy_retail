// Creates default plans, a platform super admin and a demo shop with an owner. Idempotent.
// Credentials come from env (SEED_*), see .env.example.
import { connectDB, disconnectDB } from '../config/db.js';
import { Plan } from '../modules/plans/plan.model.js';
import { ensureDefaultPlans } from '../modules/plans/plan.service.js';
import { Tenant } from '../modules/tenants/tenant.model.js';
import { User } from '../modules/users/user.model.js';
import { Branch } from '../modules/branches/branch.model.js';
import { runWithTenant } from '../plugins/tenantContext.js';

const required = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required for seeding`);
  return v;
};

await connectDB();

const adminEmail = required('SEED_ADMIN_EMAIL').toLowerCase();
const adminPass = required('SEED_ADMIN_PASSWORD');
const ownerEmail = required('SEED_OWNER_EMAIL').toLowerCase();
const ownerPass = required('SEED_OWNER_PASSWORD');

await ensureDefaultPlans();
const pro = await Plan.findOne({ code: 'pro' });

if (!(await User.exists({ tenantId: null, email: adminEmail }))) {
  await User.create({ name: 'Platform Admin', email: adminEmail, role: 'super_admin', passwordHash: await User.hashPassword(adminPass) });
  console.log(`Created platform admin: ${adminEmail}`);
}

const tenant =
  (await Tenant.findOne({ code: 'demo-pharmacy' })) ?? (await Tenant.create({ name: 'Demo Pharmacy', code: 'demo-pharmacy' }));
if (!tenant.planId && pro) {
  tenant.planId = pro._id;
  await tenant.save();
  console.log('Assigned the Pro plan to the demo shop');
}

let owner = await User.findOne({ tenantId: tenant._id, email: ownerEmail });
if (!owner) {
  owner = await User.create({ tenantId: tenant._id, name: 'Demo Owner', email: ownerEmail, role: 'shop_owner', passwordHash: await User.hashPassword(ownerPass) });
  console.log(`Created shop owner: ${ownerEmail} (shop code: ${tenant.code})`);
}
if (!tenant.ownerUserId) {
  tenant.ownerUserId = owner._id;
  await tenant.save();
}

await runWithTenant(tenant._id, async () => {
  if (!(await Branch.exists({ code: 'MAIN' }))) await Branch.create({ name: 'Main Branch', code: 'MAIN' });
});

console.log('Seed complete.');
await disconnectDB();
