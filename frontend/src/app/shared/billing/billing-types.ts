export type BillingStateName = 'trial' | 'active' | 'due_soon' | 'grace' | 'locked' | 'suspended';

export interface BillingState {
  state: BillingStateName;
  trial?: boolean;
  endsAt?: string | null;
  lockAt?: string | null;
  daysLeft?: number | null;
}

export interface InvoiceRow {
  _id: string;
  number: string;
  tenantId: string;
  tenantName?: string;
  planName?: string;
  cycle: 'monthly' | 'yearly';
  periodStart: string;
  periodEnd: string;
  amount: number;
  gstPercent: number;
  gst: number;
  total: number;
  status: 'issued' | 'paid' | 'void';
  issuedAt: string;
  dueDate: string;
  paidAt?: string;
  method?: string;
  reference?: string;
  voidReason?: string;
}

export const STATE_LABEL: Record<BillingStateName, string> = {
  trial: 'Free trial',
  active: 'Active',
  due_soon: 'Renewal due soon',
  grace: 'Payment overdue',
  locked: 'View-only (unpaid)',
  suspended: 'Suspended',
};

export const STATE_CLASS: Record<BillingStateName, string> = {
  trial: 'bg-tone-teal',
  active: 'bg-tone-lime',
  due_soon: 'bg-tone-lavender',
  grace: 'bg-tone-rose',
  locked: 'bg-tone-rose',
  suspended: 'bg-chip',
};
