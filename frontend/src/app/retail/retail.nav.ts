import { NavSection } from '../layouts/nav.model';

export const RETAIL_NAV: NavSection[] = [
  {
    title: 'Main menu',
    collapsible: false,
    items: [
      { label: 'Dashboard', icon: 'home', path: '/retail/dashboard' },
      { label: 'New sale', icon: 'cart', path: '/retail/pos', permission: 'sales.create' },
      { label: 'Products', icon: 'pill', path: '/retail/products', permission: 'inventory.view' },
      { label: 'Inventory', icon: 'bag', path: '/retail/inventory', permission: 'inventory.view' },
      { label: 'Stock count', icon: 'bag', path: '/retail/stock-count', permission: 'inventory.adjust' },
      { label: 'Suppliers', icon: 'users', path: '/retail/suppliers', anyPermission: ['purchase.create', 'reports.view'] },
      { label: 'Purchase orders', icon: 'file', path: '/retail/purchase-orders', permission: 'purchase.create' },
      { label: 'Purchases', icon: 'file', path: '/retail/purchases', anyPermission: ['purchase.create', 'reports.view'] },
      { label: 'Outlets', icon: 'pin', path: '/retail/outlets', permission: 'branch.view' },
      { label: 'Import data', icon: 'file', path: '/retail/import', permission: 'product.manage' },
      { label: 'Staff', icon: 'users', path: '/retail/staff', permission: 'user.view' },
    ],
  },
  {
    title: 'Operations',
    collapsible: true,
    items: [
      { label: 'Bills', icon: 'chart', path: '/retail/sales', anyPermission: ['sales.create', 'reports.view'] },
      { label: 'Customers', icon: 'users', path: '/retail/customers', anyPermission: ['sales.create', 'reports.view'] },
      { label: 'Refills', icon: 'pill', path: '/retail/refills', permission: 'sales.create' },
    ],
  },
  {
    title: 'Accounts',
    collapsible: true,
    items: [
      { label: 'Payments', icon: 'card', path: '/retail/payments', permission: 'user.manage' },
      { label: 'Billing', icon: 'card', path: '/retail/billing', permission: 'billing.manage' },
      { label: 'Expenses', icon: 'card', path: '/retail/expenses', permission: 'purchase.approve' },
      { label: 'Day close', icon: 'file', path: '/retail/cash-close', permission: 'purchase.approve' },
      { label: 'Reports', icon: 'file', path: '/retail/reports', permission: 'reports.view' },
      { label: 'GST filing', icon: 'file', path: '/retail/gst-filing', permission: 'reports.view' },
      { label: 'Activity', icon: 'chart', path: '/retail/activity', permission: 'user.manage' },
      { label: 'Support access', icon: 'file', path: '/retail/support-access', permission: 'user.manage' },
      { label: 'Security', icon: 'settings', path: '/retail/security' },
      { label: 'Settings', icon: 'settings', path: '/retail/settings', permission: 'user.manage' },
    ],
  },
];
