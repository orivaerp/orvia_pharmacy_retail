import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { apiError } from '../../shared/utils/api';
import { RetailApi, SupportAccess } from '../retail-api.service';

/** The owner's record of every time Orvia support looked at this shop's data: who, why, when, what. */
@Component({
  selector: 'app-support-access',
  imports: [DatePipe],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Support access</h1>
    <p class="mt-0.5 text-xs text-ink-soft">
      Your shop's data is private. Orvia support can only look at it for a stated reason, read-only, for 30 minutes at a time, and every look is listed here.
    </p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    <section class="card mt-3">
      <div class="overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-176 text-left">
          <thead>
            <tr class="text-[11px] text-ink-soft">
              <th class="py-1.5 pr-3 font-normal">When</th>
              <th class="py-1.5 pr-3 font-normal">Who</th>
              <th class="py-1.5 pr-3 font-normal">Reason given</th>
              <th class="py-1.5 pr-3 font-normal">What was opened</th>
              <th class="py-1.5 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (s of rows(); track s._id) {
              <tr class="border-t border-line text-xs">
                <td class="py-2 pr-3 whitespace-nowrap">{{ s.startedAt | date: 'dd MMM yyyy, HH:mm' }}</td>
                <td class="py-2 pr-3 font-medium">{{ s.by }}</td>
                <td class="py-2 pr-3">{{ s.reason }}</td>
                <td class="py-2 pr-3">{{ s.areas.length ? s.areas.join(', ') : 'Nothing yet' }} <span class="text-ink-soft">({{ s.views }} view{{ s.views === 1 ? '' : 's' }})</span></td>
                <td class="py-2"><span class="badge" [class]="s.active ? 'bg-tone-rose' : 'bg-chip'">{{ s.active ? 'in progress' : 'ended' }}</span></td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No one from Orvia has looked at your shop’s data.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class SupportAccessPage implements OnInit {
  private readonly api = inject(RetailApi);
  protected readonly rows = signal<SupportAccess[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit() {
    this.api.supportAccess().subscribe({
      next: (r) => {
        this.rows.set(r);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }
}
