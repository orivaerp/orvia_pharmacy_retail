/**
 * Theme registry. To add a theme:
 *  1. copy src/themes/mint.css to <id>.css and change the variable values,
 *     scoping them to [data-theme='<id>'];
 *  2. @import it in src/styles.css;
 *  3. add an entry below.
 * The theme switcher and chart colours pick it up automatically.
 */
export interface ThemeDef {
  id: string;
  label: string;
  /** colour shown in the switcher */
  swatch: string;
}

export const THEMES: readonly ThemeDef[] = [
  { id: 'mint', label: 'Mint', swatch: '#083a39' },
  { id: 'ocean', label: 'Ocean', swatch: '#0b3a73' },
];

export const DEFAULT_THEME = THEMES[0].id;
