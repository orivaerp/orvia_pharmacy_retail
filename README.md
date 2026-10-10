# Orvia - Pharmacy Retail SaaS

Multi-tenant pharmacy retail + inventory management. Frontend and backend live in separate folders.

| Folder | Stack |
|---|---|
| `frontend/` | Angular 21, Tailwind CSS 4, standalone components + signals |
| `backend/` | Node.js, Express 5, Mongoose, MongoDB Atlas, JWT |

## Run

**Backend** (needs a MongoDB Atlas connection string)

```bash
cd backend
cp .env.example .env.development   # fill MONGO_URI, JWT secrets, SEED_* passwords (see ADMIN-README for every variable)
npm run seed           # platform admin + demo shop (code: demo-pharmacy)
npm run dev            # http://localhost:5000/api/v1
```

**Frontend**

```bash
cd frontend
npm start              # http://localhost:4200
```

## Structure

```
backend/src
  config/        env validation (zod), Mongo connection
  constants/     permission-based RBAC definitions
  middleware/    auth (JWT + tenant context), validation, errors
  plugins/       tenantPlugin - auto-scopes every query by tenantId
  modules/       auth, tenants, plans, users, branches, products, medicines, stock, purchases,
                 sales, customers, payments, billing, mail, audit, support, provider (feature-per-folder)
  scripts/       seed

frontend/src
  themes/          one CSS file per theme + themes.ts registry
  app/
    core/          auth service, scope guards, HTTP interceptor, theme service
    shared/        reusable UI: icon, logo, chart-canvas (Chart.js wrapper)
    layouts/       app-shell (sidebar + topbar), driven by each area's nav config
    auth/          login
    provider/      SERVICE PROVIDER area (platform staff): routes, nav, pages
    retail/        RETAIL SHOP area (tenant staff): routes, nav, pages
```

Both areas are lazy-loaded from one Angular app and protected by `scopeGuard`:
platform users land on `/provider`, shop users on `/retail`. Each area owns its routes
(`*.routes.ts`), navigation (`*.nav.ts`) and feature folders, and imports only from
`core/`, `shared/` and `layouts/`, never from the other area. That keeps either one
easy to split into its own app later.

## Multi-tenancy

Shared DB with `tenantId`. `tenantPlugin` throws when a tenant-scoped model is queried
without tenant context, so a forgotten filter cannot leak data. Platform staff have
`tenantId = null`; login with an optional shop code selects the tenant.

## What is built, and what is left

See **ADMIN-README.md**: the full list of what works (shops, plans and billing, medicine catalog,
outlets, stock, purchasing, POS, customers, reports, UPI payments, audit, 2FA, email), how it is
configured, how it was checked, a go-live checklist and what is not built yet.
