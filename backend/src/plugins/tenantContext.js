import { AsyncLocalStorage } from 'node:async_hooks';

// Holds the current request's tenant so the Mongoose tenant plugin can inject it automatically.
export const tenantStore = new AsyncLocalStorage();

export const runWithTenant = (tenantId, fn) => tenantStore.run({ tenantId }, fn);
export const currentTenantId = () => tenantStore.getStore()?.tenantId ?? null;
