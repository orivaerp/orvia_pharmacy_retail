import { Injectable, signal } from '@angular/core';
import { DEFAULT_THEME, THEMES } from '../../../themes/themes';

const KEY = 'orvia.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly themes = THEMES;
  private readonly _current = signal(this.initial());
  readonly current = this._current.asReadonly();

  constructor() {
    document.documentElement.dataset['theme'] = this._current();
  }

  set(id: string) {
    if (!THEMES.some((t) => t.id === id)) return;
    // attribute first, so anything reacting to the signal reads the new CSS variables
    document.documentElement.dataset['theme'] = id;
    this._current.set(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  }

  /** Resolved value of a theme CSS variable, e.g. cssVar('--chart-1'). */
  cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  private initial(): string {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && THEMES.some((t) => t.id === saved)) return saved;
    } catch {}
    return DEFAULT_THEME;
  }
}
