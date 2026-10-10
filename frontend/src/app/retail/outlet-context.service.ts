import { Injectable, computed, inject, signal } from '@angular/core';
import { Outlet, RetailApi } from './retail-api.service';

const KEY = 'orvia.outlet';

/**
 * The outlet the user is currently working in. '' means "all outlets I can see".
 * Staff only ever get their own outlets from the server, so "all" can never go beyond what they are allowed.
 */
@Injectable({ providedIn: 'root' })
export class OutletContext {
  private readonly api = inject(RetailApi);

  readonly outlets = signal<Outlet[]>([]);
  readonly loaded = signal(false);
  readonly selected = signal<string>(this.saved());

  /** the outlets to offer (active ones) */
  readonly choices = computed(() => this.outlets().filter((o) => o.isActive));
  readonly selectedOutlet = computed(() => this.choices().find((o) => o._id === this.selected()) ?? null);

  /** The outlet picked in the top bar, or the user's only outlet; '' when it is not clear which one. */
  readonly activeId = computed(() => this.selected() || (this.choices().length === 1 ? this.choices()[0]._id : ''));

  /** Loads the outlets once. Call again after outlets change. */
  load(force = false) {
    if (this.loaded() && !force) return;
    this.api.outlets().subscribe({
      next: (o) => {
        this.outlets.set(o);
        this.loaded.set(true);
        // forget a saved outlet that no longer exists or is no longer allowed
        if (this.selected() && !o.some((x) => x._id === this.selected() && x.isActive)) this.select('');
      },
      error: () => this.loaded.set(true),
    });
  }

  select(id: string) {
    this.selected.set(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  }

  private saved(): string {
    try {
      return localStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  }
}
