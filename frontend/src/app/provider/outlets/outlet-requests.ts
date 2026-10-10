import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiError } from '../../shared/utils/api';
import { ProviderApi, ProviderOutletRequest } from '../provider-api.service';

const STATUS_CLASS: Record<string, string> = { pending: 'bg-tone-lavender', approved: 'bg-tone-lime', rejected: 'bg-tone-rose' };

@Component({
  selector: 'app-outlet-requests',
  imports: [DatePipe, RouterLink],
  templateUrl: './outlet-requests.html',
})
export class OutletRequests implements OnInit {
  private readonly api = inject(ProviderApi);

  protected readonly statusClass = STATUS_CLASS;
  protected readonly items = signal<ProviderOutletRequest[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected status = 'pending';

  /** which request has its approve / reject panel open, and the panel's inputs */
  protected readonly panel = signal<{ id: string; mode: 'approve' | 'reject' } | null>(null);
  protected granted = 1;
  protected note = '';

  ngOnInit() {
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.api.outletRequests(this.status).subscribe({
      next: (r) => {
        this.items.set(r);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  protected setStatus(s: string) {
    this.status = s;
    this.panel.set(null);
    this.load();
  }

  protected open(r: ProviderOutletRequest, mode: 'approve' | 'reject') {
    this.granted = r.count;
    this.note = '';
    this.error.set(null);
    this.panel.set({ id: r._id, mode });
  }

  protected submit() {
    const p = this.panel();
    if (!p) return;
    if (p.mode === 'reject' && this.note.trim().length < 3) return this.error.set('Please give a short reason (at least 3 characters).');
    this.busy.set(true);
    this.error.set(null);
    const req = p.mode === 'approve' ? this.api.approveOutletRequest(p.id, Math.max(1, Number(this.granted) || 1), this.note.trim()) : this.api.rejectOutletRequest(p.id, this.note.trim());
    req.subscribe({
      next: () => {
        this.busy.set(false);
        this.panel.set(null);
        this.notice.set(p.mode === 'approve' ? 'Approved. The shop can add the extra outlets now.' : 'Request rejected.');
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
