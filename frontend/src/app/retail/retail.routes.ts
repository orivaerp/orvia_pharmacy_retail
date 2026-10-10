import { Routes } from '@angular/router';
import { anyPermissionGuard, permissionGuard } from '../core/guards/auth.guard';
import { AppShell } from '../layouts/app-shell';
import { OutletSwitcher } from './outlet-switcher';
import { RETAIL_NAV } from './retail.nav';

// Retail shop area. Add feature pages (products, purchase, pos, ...) as children below.
export const RETAIL_ROUTES: Routes = [
  {
    path: '',
    component: AppShell,
    data: { nav: RETAIL_NAV, topbar: OutletSwitcher },
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./dashboard/dashboard').then((m) => m.Dashboard),
        title: 'Dashboard | Orvia',
      },
      {
        path: 'products',
        canActivate: [permissionGuard('inventory.view')],
        loadComponent: () => import('./products/products').then((m) => m.Products),
        title: 'Products | Orvia',
      },
      {
        path: 'pos',
        canActivate: [permissionGuard('sales.create')],
        loadComponent: () => import('./sales/pos').then((m) => m.Pos),
        title: 'New sale | Orvia',
      },
      {
        path: 'sales',
        canActivate: [anyPermissionGuard('sales.create', 'reports.view')],
        loadComponent: () => import('./sales/sales').then((m) => m.Sales),
        title: 'Bills | Orvia',
      },
      {
        path: 'sales/:id',
        canActivate: [anyPermissionGuard('sales.create', 'reports.view')],
        loadComponent: () => import('./sales/sale-detail').then((m) => m.SaleDetailPage),
        title: 'Bill | Orvia',
      },
      {
        path: 'security',
        loadComponent: () => import('../shared/pages/security').then((m) => m.Security),
        title: 'Security | Orvia',
      },
      {
        path: 'billing',
        canActivate: [permissionGuard('billing.manage')],
        loadComponent: () => import('./billing/billing').then((m) => m.Billing),
        title: 'Billing | Orvia',
      },
      {
        path: 'payments',
        canActivate: [permissionGuard('user.manage')],
        loadComponent: () => import('./payments/payments').then((m) => m.Payments),
        title: 'Payments | Orvia',
      },
      {
        path: 'import',
        canActivate: [permissionGuard('product.manage')],
        loadComponent: () => import('./import/import-hub').then((m) => m.ImportHub),
        title: 'Import | Orvia',
      },
      {
        path: 'expenses',
        canActivate: [permissionGuard('purchase.approve')],
        loadComponent: () => import('./accounts/expenses').then((m) => m.Expenses),
        title: 'Expenses | Orvia',
      },
      {
        path: 'cash-close',
        canActivate: [permissionGuard('purchase.approve')],
        loadComponent: () => import('./accounts/cash-close').then((m) => m.CashClose),
        title: 'Day close | Orvia',
      },
      {
        path: 'activity',
        canActivate: [permissionGuard('user.manage')],
        loadComponent: () => import('./activity/activity').then((m) => m.Activity),
        title: 'Activity | Orvia',
      },
      {
        path: 'settings',
        canActivate: [permissionGuard('user.manage')],
        loadComponent: () => import('./settings/settings').then((m) => m.ShopSettings),
        title: 'Settings | Orvia',
      },
      {
        path: 'refills',
        canActivate: [permissionGuard('sales.create')],
        loadComponent: () => import('./customers/refills').then((m) => m.Refills),
        title: 'Refills | Orvia',
      },
      {
        path: 'customers',
        canActivate: [anyPermissionGuard('sales.create', 'reports.view')],
        loadComponent: () => import('./customers/customers').then((m) => m.Customers),
        title: 'Customers | Orvia',
      },
      {
        path: 'customers/:id',
        canActivate: [anyPermissionGuard('sales.create', 'reports.view')],
        loadComponent: () => import('./customers/customer-detail').then((m) => m.CustomerDetailPage),
        title: 'Customer | Orvia',
      },
      {
        path: 'reports',
        canActivate: [permissionGuard('reports.view')],
        loadComponent: () => import('./reports/reports').then((m) => m.Reports),
        title: 'Reports | Orvia',
      },
      {
        path: 'outlets',
        canActivate: [permissionGuard('branch.view')],
        loadComponent: () => import('./outlets/outlets').then((m) => m.Outlets),
        title: 'Outlets | Orvia',
      },
      {
        path: 'support-access',
        canActivate: [permissionGuard('user.manage')],
        loadComponent: () => import('./support/support-access').then((m) => m.SupportAccessPage),
        title: 'Support access | Orvia',
      },
      {
        path: 'staff',
        canActivate: [permissionGuard('user.view')],
        loadComponent: () => import('./staff/staff').then((m) => m.Staff),
        title: 'Staff | Orvia',
      },
      {
        path: 'inventory',
        canActivate: [permissionGuard('inventory.view')],
        loadComponent: () => import('./inventory/inventory').then((m) => m.Inventory),
        title: 'Inventory | Orvia',
      },
      {
        path: 'suppliers',
        canActivate: [anyPermissionGuard('purchase.create', 'reports.view')],
        loadComponent: () => import('./purchasing/suppliers').then((m) => m.Suppliers),
        title: 'Suppliers | Orvia',
      },
      {
        path: 'suppliers/:id',
        canActivate: [anyPermissionGuard('purchase.create', 'reports.view')],
        loadComponent: () => import('./purchasing/supplier-detail').then((m) => m.SupplierDetail),
        title: 'Supplier | Orvia',
      },
      {
        path: 'purchases',
        canActivate: [anyPermissionGuard('purchase.create', 'reports.view')],
        loadComponent: () => import('./purchasing/purchases').then((m) => m.Purchases),
        title: 'Purchases | Orvia',
      },
      {
        path: 'purchase-orders',
        canActivate: [permissionGuard('purchase.create')],
        loadComponent: () => import('./purchasing/orders').then((m) => m.Orders),
        title: 'Purchase orders | Orvia',
      },
      {
        path: 'purchase-orders/new',
        canActivate: [permissionGuard('purchase.create')],
        loadComponent: () => import('./purchasing/order-form').then((m) => m.OrderForm),
        title: 'New purchase order | Orvia',
      },
      {
        path: 'purchase-orders/:id/edit',
        canActivate: [permissionGuard('purchase.create')],
        loadComponent: () => import('./purchasing/order-form').then((m) => m.OrderForm),
        title: 'Change purchase order | Orvia',
      },
      {
        path: 'purchase-orders/:id',
        canActivate: [permissionGuard('purchase.create')],
        loadComponent: () => import('./purchasing/order-detail').then((m) => m.OrderDetail),
        title: 'Purchase order | Orvia',
      },
      {
        path: 'purchases/new',
        canActivate: [permissionGuard('purchase.create')],
        loadComponent: () => import('./purchasing/purchase-new').then((m) => m.PurchaseNew),
        title: 'New purchase | Orvia',
      },
      {
        path: 'purchases/:id',
        canActivate: [anyPermissionGuard('purchase.create', 'reports.view')],
        loadComponent: () => import('./purchasing/purchase-detail').then((m) => m.PurchaseDetailPage),
        title: 'Purchase | Orvia',
      },
      {
        path: 'stock-count',
        canActivate: [permissionGuard('inventory.adjust')],
        loadComponent: () => import('./inventory/stock-count').then((m) => m.StockCount),
        title: 'Stock count | Orvia',
      },
      {
        path: 'inventory/order-list',
        canActivate: [permissionGuard('inventory.view')],
        loadComponent: () => import('./inventory/order-list').then((m) => m.OrderList),
        title: 'Order list | Orvia',
      },
      {
        path: 'inventory/history',
        canActivate: [permissionGuard('inventory.view')],
        loadComponent: () => import('./inventory/stock-history').then((m) => m.StockHistory),
        title: 'Stock history | Orvia',
      },
      {
        path: 'inventory/add',
        canActivate: [permissionGuard('inventory.adjust')],
        loadComponent: () => import('./inventory/stock-entry').then((m) => m.StockEntryPage),
        title: 'Add stock | Orvia',
      },
    ],
  },
];
