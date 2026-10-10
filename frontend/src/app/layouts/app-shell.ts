import { NgComponentOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { ThemeService } from '../core/services/theme.service';
import { Icon } from '../shared/components/icon';
import { Logo } from '../shared/components/logo';
import { BillingBanner } from '../shared/billing/billing-banner';
import { NavSection } from './nav.model';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgComponentOutlet, Logo, Icon, BillingBanner],
  templateUrl: './app-shell.html',
})
export class AppShell {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);

  protected readonly menuOpen = signal(false);
  private readonly collapsed = signal<Record<string, boolean>>({});

  // Navigation comes from the active area's route data (provider.nav.ts / retail.nav.ts).
  private readonly route = inject(ActivatedRoute).snapshot.data;
  private readonly allSections: NavSection[] = this.route['nav'] ?? [];
  protected readonly sections = computed(() =>
    this.allSections
      .map((s) => ({ ...s, items: s.items.filter((i) => (!i.permission || this.auth.hasPermission(i.permission)) && (!i.anyPermission || i.anyPermission.some((p) => this.auth.hasPermission(p)))) }))
      .filter((s) => s.items.length),
  );

  /** An area can put its own component in the top bar (retail: the outlet switcher). */
  protected readonly topbar = this.route['topbar'] ?? null;

  protected isCollapsed(title: string) {
    return !!this.collapsed()[title];
  }

  protected toggle(title: string) {
    this.collapsed.update((c) => ({ ...c, [title]: !c[title] }));
  }

  protected initials(name?: string) {
    return (name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  }
}
