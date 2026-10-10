import { Component, inject } from '@angular/core';
import { AuthService } from '../core/services/auth.service';
import { Icon } from '../shared/components/icon';
import { OutletContext } from './outlet-context.service';

/** Top-bar dropdown: work in one outlet, or see all of them. Hidden when there is only one outlet to choose from. */
@Component({
  selector: 'app-outlet-switcher',
  imports: [Icon],
  template: `
    @if (ctx.choices().length > 1) {
      <label class="flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs">
        <app-icon name="pin" [size]="13" />
        <span class="sr-only">Outlet</span>
        <select class="max-w-40 bg-transparent text-xs outline-none" aria-label="Outlet" (change)="ctx.select($any($event.target).value)">
          <option value="" [selected]="!ctx.selected()">{{ restricted ? 'All my outlets' : 'All outlets' }}</option>
          @for (o of ctx.choices(); track o._id) { <option [value]="o._id" [selected]="o._id === ctx.selected()">{{ o.name }}</option> }
        </select>
      </label>
    }
  `,
})
export class OutletSwitcher {
  protected readonly ctx = inject(OutletContext);
  private readonly auth = inject(AuthService);

  protected readonly restricted = (this.auth.user()?.branchIds?.length ?? 0) > 0;

  constructor() {
    this.ctx.load();
  }
}
