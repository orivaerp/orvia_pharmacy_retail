import { HttpErrorResponse } from '@angular/common/http';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Friendly message from a failed API call (first validation detail if there is one). */
export function apiError(e: unknown): string {
  const err = e as HttpErrorResponse;
  if (err?.status === 0) return 'Cannot reach the server. Please try again.';
  const d = err?.error?.details?.[0];
  return d ? `${d.path ? d.path + ': ' : ''}${d.message}` : (err?.error?.message ?? 'Something went wrong.');
}

/** Splits "a; b | c" style text into a clean list. */
export const splitList = (s: string | null | undefined): string[] =>
  (s ?? '').split(/[;|]/).map((x) => x.trim()).filter(Boolean);
