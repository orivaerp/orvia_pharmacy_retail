import mongoose from 'mongoose';
import { currentTenantId } from './tenantContext.js';

const QUERY_OPS = [
  'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'countDocuments', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
];

/**
 * Adds `tenantId` to a schema and forces every query/save to be scoped to the current tenant.
 * A query with no tenant context throws, so a forgotten filter can never leak data.
 * Platform-level code can opt out explicitly with `.setOptions({ skipTenant: true })`.
 */
export function tenantPlugin(schema) {
  schema.add({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  });

  for (const op of QUERY_OPS) {
    schema.pre(op, function () {
      if (this.getOptions().skipTenant) return;
      const tenantId = currentTenantId();
      if (!tenantId) throw new Error(`Tenant context missing for ${this.model.modelName}.${op}`);
      this.where({ tenantId });
    });
  }

  schema.pre('aggregate', function () {
    if (this.options.skipTenant) return;
    const tenantId = currentTenantId();
    if (!tenantId) throw new Error('Tenant context missing for aggregate');
    this.pipeline().unshift({ $match: { tenantId: new mongoose.Types.ObjectId(tenantId) } });
  });

  schema.pre('validate', function () {
    if (!this.tenantId) this.tenantId = currentTenantId();
  });
}
