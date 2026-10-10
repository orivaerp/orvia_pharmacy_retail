// Permission-based RBAC. Roles map to permission sets, never checked by role name in routes.
export const PERMISSIONS = Object.freeze({
  // platform (service provider) level
  TENANT_VIEW: 'tenant.view',
  TENANT_MANAGE: 'tenant.manage',
  PLAN_MANAGE: 'plan.manage',
  MEDICINE_MANAGE: 'medicine.manage',
  SUPPORT_VIEW: 'support.view',
  AUDIT_VIEW: 'audit.view',
  PLATFORM_USERS_MANAGE: 'platform.users.manage',
  BILLING_ADMIN: 'billing.admin', // issue, mark paid, void and extend invoices for every shop
  // shop (tenant) level
  USER_VIEW: 'user.view',
  USER_MANAGE: 'user.manage',
  BRANCH_VIEW: 'branch.view',
  BRANCH_MANAGE: 'branch.manage',
  PRODUCT_MANAGE: 'product.manage',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUST: 'inventory.adjust',
  PURCHASE_CREATE: 'purchase.create',
  PURCHASE_APPROVE: 'purchase.approve',
  SALES_CREATE: 'sales.create',
  REPORTS_VIEW: 'reports.view',
  BILLING_MANAGE: 'billing.manage', // the shop's own subscription: see invoices and pay (owner only)
});

const P = PERMISSIONS;
const all = Object.values(P);
const PLATFORM_ONLY = [P.TENANT_VIEW, P.TENANT_MANAGE, P.PLAN_MANAGE, P.MEDICINE_MANAGE, P.SUPPORT_VIEW, P.AUDIT_VIEW, P.PLATFORM_USERS_MANAGE, P.BILLING_ADMIN];
const shopAll = all.filter((p) => !PLATFORM_ONLY.includes(p));

export const SCOPES = Object.freeze({ PLATFORM: 'platform', TENANT: 'tenant' });

// Default role templates. Tenant admins will be able to create custom roles later.
export const DEFAULT_ROLES = Object.freeze({
  super_admin: { scope: SCOPES.PLATFORM, permissions: all },
  support: { scope: SCOPES.PLATFORM, permissions: [P.TENANT_VIEW, P.SUPPORT_VIEW, P.USER_VIEW, P.BRANCH_VIEW, P.INVENTORY_VIEW, P.REPORTS_VIEW] },
  shop_owner: { scope: SCOPES.TENANT, permissions: shopAll },
  branch_manager: { scope: SCOPES.TENANT, permissions: [P.USER_VIEW, P.BRANCH_VIEW, P.INVENTORY_VIEW, P.INVENTORY_ADJUST, P.PRODUCT_MANAGE, P.PURCHASE_CREATE, P.PURCHASE_APPROVE, P.SALES_CREATE, P.REPORTS_VIEW] },
  pharmacist: { scope: SCOPES.TENANT, permissions: [P.BRANCH_VIEW, P.INVENTORY_VIEW, P.SALES_CREATE] },
  cashier: { scope: SCOPES.TENANT, permissions: [P.BRANCH_VIEW, P.SALES_CREATE] },
  store_keeper: { scope: SCOPES.TENANT, permissions: [P.BRANCH_VIEW, P.INVENTORY_VIEW, P.INVENTORY_ADJUST, P.PRODUCT_MANAGE, P.PURCHASE_CREATE] },
  accountant: { scope: SCOPES.TENANT, permissions: [P.BRANCH_VIEW, P.REPORTS_VIEW] },
});

export const permissionsForRole = (role) => DEFAULT_ROLES[role]?.permissions ?? [];

/** Roles a shop owner can give to staff (the owner role itself is created by the provider). */
export const STAFF_ROLES = Object.entries(DEFAULT_ROLES)
  .filter(([role, def]) => def.scope === SCOPES.TENANT && role !== 'shop_owner')
  .map(([role]) => role);
