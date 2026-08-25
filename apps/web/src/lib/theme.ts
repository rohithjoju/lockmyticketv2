/**
 * Theme preference, stored in a plain cookie rather than localStorage.
 *
 * The reason is flash: the server layout reads the cookie and stamps
 * `data-theme` on <html> before the first byte, so the page never paints in
 * the wrong palette and no blocking inline script is needed to prevent it.
 * A blocking script would also have to be exempted from the CSP, which is a
 * poor trade for a colour choice.
 */

export const THEME_COOKIE = 'lmt_theme';
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(raw: string | undefined | null): Theme {
  return THEMES.includes(raw as Theme) ? (raw as Theme) : 'system';
}

/**
 * The value for the `data-theme` attribute. `system` returns null: the
 * attribute is left off entirely so the `prefers-color-scheme` media query in
 * globals.css is the one that decides.
 */
export function themeAttribute(theme: Theme): 'light' | 'dark' | null {
  return theme === 'system' ? null : theme;
}

/** The toggle walks system → light → dark → system. */
export function nextTheme(current: Theme): Theme {
  const index = THEMES.indexOf(current);
  return THEMES[(index + 1) % THEMES.length]!;
}

export function themeLabel(theme: Theme): string {
  return theme === 'system' ? 'Match system' : theme === 'light' ? 'Light' : 'Dark';
}

/** SameSite=Lax, not httpOnly — the client toggle has to write it too. */
export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_MAX_AGE}; samesite=lax`;
}

/** Applies a choice to the live document. Exported so the toggle stays declarative. */
export function applyTheme(theme: Theme, root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }): void {
  const attribute = themeAttribute(theme);
  if (attribute) root.setAttribute('data-theme', attribute);
  else root.removeAttribute('data-theme');
}
