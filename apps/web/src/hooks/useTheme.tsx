'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { applyTheme, nextTheme, themeCookie, type Theme } from '@/lib/theme';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme, event?: React.MouseEvent | MouseEvent) => void;
  cycle: (event?: React.MouseEvent | MouseEvent) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

type TransitionDefinition = (
  x: number,
  y: number,
  radius: number,
) => {
  keyframes: Keyframe[] | PropertyIndexedKeyframes;
  options: KeyframeAnimationOptions;
};

/**
 * Curated suite of high-framerate, GPU-accelerated theme transition animations.
 * A different effect is randomly selected on each switch for delightful variety.
 */
const TRANSITIONS: TransitionDefinition[] = [
  // 1. Radial ripple expanding outward from click coordinates
  (x, y, radius) => ({
    keyframes: {
      clipPath: [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${radius}px at ${x}px ${y}px)`,
      ],
    },
    options: {
      duration: 600,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      pseudoElement: '::view-transition-new(root)',
    },
  }),

  // 2. Vertical curtain drop (top to bottom)
  () => ({
    keyframes: {
      clipPath: ['inset(0 0 100% 0)', 'inset(0 0 0% 0)'],
    },
    options: {
      duration: 520,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      pseudoElement: '::view-transition-new(root)',
    },
  }),

  // 3. Vertical curtain rise (bottom to top)
  () => ({
    keyframes: {
      clipPath: ['inset(100% 0 0 0)', 'inset(0% 0 0 0)'],
    },
    options: {
      duration: 520,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      pseudoElement: '::view-transition-new(root)',
    },
  }),

  // 4. Horizontal sweep left-to-right
  () => ({
    keyframes: {
      clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'],
    },
    options: {
      duration: 520,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      pseudoElement: '::view-transition-new(root)',
    },
  }),

  // 5. Horizontal sweep right-to-left
  () => ({
    keyframes: {
      clipPath: ['inset(0 0 0 100%)', 'inset(0 0 0 0%)'],
    },
    options: {
      duration: 520,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      pseudoElement: '::view-transition-new(root)',
    },
  }),

  // 6. Split shutter opening horizontally from center
  () => ({
    keyframes: {
      clipPath: ['inset(0 50% 0 50%)', 'inset(0 0% 0 0%)'],
    },
    options: {
      duration: 560,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      pseudoElement: '::view-transition-new(root)',
    },
  }),

  // 7. Diagonal polygon slice sweep
  () => ({
    keyframes: {
      clipPath: [
        'polygon(0 0, 0 0, 0 0, 0 0)',
        'polygon(0 0, 220% 0, 0 220%, 0 0)',
      ],
    },
    options: {
      duration: 560,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      pseudoElement: '::view-transition-new(root)',
    },
  }),

  // 8. Expanding diamond iris centered at click position
  (x, y, radius) => ({
    keyframes: {
      clipPath: [
        `polygon(${x}px ${y}px, ${x}px ${y}px, ${x}px ${y}px, ${x}px ${y}px)`,
        `polygon(${x}px ${y - radius * 1.5}px, ${x + radius * 1.5}px ${y}px, ${x}px ${y + radius * 1.5}px, ${x - radius * 1.5}px ${y}px)`,
      ],
    },
    options: {
      duration: 600,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      pseudoElement: '::view-transition-new(root)',
    },
  }),

  // 9. Cinematic depth scale reveal
  () => ({
    keyframes: {
      opacity: [0, 1],
      transform: ['scale(0.96)', 'scale(1)'],
    },
    options: {
      duration: 480,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      pseudoElement: '::view-transition-new(root)',
    },
  }),
];

let lastTransitionIndex = -1;

function pickRandomTransition(): TransitionDefinition {
  let index = Math.floor(Math.random() * TRANSITIONS.length);
  if (index === lastTransitionIndex && TRANSITIONS.length > 1) {
    index = (index + 1) % TRANSITIONS.length;
  }
  lastTransitionIndex = index;
  return TRANSITIONS[index]!;
}

/**
 * `initial` comes from the cookie the server already read, so the first client
 * render agrees with the markup and React does not warn about a mismatch.
 * Changing the theme writes the cookie and stamps <html> in the same tick.
 */
export function ThemeProvider({
  initial,
  children,
}: {
  initial: Theme;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initial);

  // Keep live sync with OS appearance when 'system' is selected
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (theme === 'system') {
        applyTheme('system', document.documentElement);
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme, event?: React.MouseEvent | MouseEvent) => {
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Fallback for browsers without View Transitions or users requesting reduced motion
      if (!document.startViewTransition || prefersReducedMotion) {
        document.documentElement.classList.add('theme-transition');
        setThemeState(next);
        document.cookie = themeCookie(next);
        applyTheme(next, document.documentElement);
        window.setTimeout(() => {
          document.documentElement.classList.remove('theme-transition');
        }, 350);
        return;
      }

      // Compute origin coordinates for localized transitions
      let x = event?.clientX;
      let y = event?.clientY;
      if (x == null || y == null) {
        if (event?.currentTarget && 'getBoundingClientRect' in event.currentTarget) {
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          x = rect.left + rect.width / 2;
          y = rect.top + rect.height / 2;
        } else {
          x = window.innerWidth / 2;
          y = window.innerHeight / 2;
        }
      }

      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      const transitionAnim = pickRandomTransition();

      const transition = document.startViewTransition(() => {
        setThemeState(next);
        document.cookie = themeCookie(next);
        applyTheme(next, document.documentElement);
      });

      transition.ready
        .then(() => {
          const anim = transitionAnim(x, y, endRadius);
          document.documentElement.animate(anim.keyframes, anim.options);
        })
        .catch(() => {
          // Transition was aborted or superseded; noop
        });
    },
    [],
  );

  const cycle = useCallback(
    (e?: React.MouseEvent | MouseEvent) => {
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
