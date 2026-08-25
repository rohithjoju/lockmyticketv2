'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { applyTheme, nextTheme, themeCookie, type Theme } from '@/lib/theme';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  cycle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * `initial` comes from the cookie the server already read, so the first client
 * render agrees with the markup and React does not warn about a mismatch.
 * Changing the theme writes the cookie and stamps <html> in the same tick —
 * no reload, and the next server render starts from the new value.
 */
export function ThemeProvider({
  initial,
  children,
}: {
  initial: Theme;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initial);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.cookie = themeCookie(next);
    applyTheme(next, document.documentElement);
  }, []);

  const cycle = useCallback(() => setTheme(nextTheme(theme)), [setTheme, theme]);

  const value = useMemo(() => ({ theme, setTheme, cycle }), [theme, setTheme, cycle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
