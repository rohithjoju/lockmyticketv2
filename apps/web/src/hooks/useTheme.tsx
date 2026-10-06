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

  const setTheme = useCallback(
    (next: Theme, event?: React.MouseEvent | MouseEvent) => {
      // Check if View Transition API is supported and user doesn't prefer reduced motion
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (!document.startViewTransition || prefersReducedMotion) {
        setThemeState(next);
        document.cookie = themeCookie(next);
        applyTheme(next, document.documentElement);
        return;
      }

      // Calculate origin coordinates for the circular ripple
      const x = event?.clientX ?? window.innerWidth / 2;
      const y = event?.clientY ?? window.innerHeight / 2;
      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      const transition = document.startViewTransition(() => {
        setThemeState(next);
        document.cookie = themeCookie(next);
        applyTheme(next, document.documentElement);
      });

      transition.ready.then(() => {
        // Animate circular clip-path expanding across the entire viewport
        const clipPath = [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`,
        ];
        document.documentElement.animate(
          {
            clipPath: clipPath,
          },
          {
            duration: 650,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        );
      });
    },
    [],
  );

  const cycle = useCallback(
    (e?: React.MouseEvent) => {
      setTheme(nextTheme(theme), e);
    },
    [setTheme, theme],
  );

  const value = useMemo(() => ({ theme, setTheme, cycle }), [theme, setTheme, cycle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
