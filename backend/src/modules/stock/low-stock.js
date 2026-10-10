import { currentTenantId } from '../../plugins/tenantContext.js';
import { Tenant } from '../tenants/tenant.model.js';

/** The shop's default "low stock" level in packs (used for products that have none of their own). Needs a tenant context. */
export async function getLowStockDefault() {
  const t = await Tenant.findById(currentTenantId()).select('lowStockDefault').lean();
  return t?.lowStockDefault ?? 5;
}

/** A product's own level wins; otherwise the shop's default. 0 means no alert. */
export const effectiveReorder = (own, shopDefault) => (own > 0 ? own : shopDefault);
