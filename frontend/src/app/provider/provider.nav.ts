import { NavSection } from '../layouts/nav.model';

export const PROVIDER_NAV: NavSection[] = [
  {
    title: 'Platform',
    collapsible: false,
    items: [
      { label: 'Overview', icon: 'home', path: '/provider/dashboard' },
      { label: 'Shops', icon: 'bag', path: '/provider/shops' },
      { label: 'Plans', icon: 'card', path: '/provider/plans' },
      { label: 'Billing', icon: 'card', path: '/provider/billing', permission: 'billing.admin' },
      { label: 'Outlet requests', icon: 'pin', path: '/provider/outlet-requests' },
      { label: 'Medicine Master', icon: 'pill', path: '/provider/medicines' },
      { label: 'Shop requests', icon: 'file', path: '/provider/medicine-requests' },
    ],
  },
  {
    title: 'Operations',
    collapsible: true,
    items: [
      { label: 'Platform users', icon: 'users', path: '/provider/platform-users', permission: 'platform.users.manage' },
      { label: 'Email', icon: 'file', path: '/provider/email', permission: 'platform.users.manage' },
      { label: 'Security', icon: 'settings', path: '/provider/security' },
      { label: 'Audit log', icon: 'file', path: '/provider/audit-log', permission: 'audit.view' },
      { label: 'Settings', icon: 'settings' },
    ],
  },
];
