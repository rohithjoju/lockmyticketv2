'use client';

import { useTheme } from '@/hooks/useTheme';
import { themeLabel } from '@/lib/theme';
import { Icon } from './Icon';

const GLYPH = { system: 'auto', light: 'sun', dark: 'moon' } as const;

export function ThemeToggle() {
  const { theme, cycle } = useTheme();

  return (
    <button
      type="button"
      onClick={cycle}
      // The label carries the current state, not the next one: a screen reader
      // announcing "Dark" on a button that switches to light is a lie.
      aria-label={`Theme: ${themeLabel(theme)}. Change theme.`}
      title={themeLabel(theme)}
      className="grid size-9 place-items-center rounded-full border border-line text-muted transition hover:border-line-strong hover:text-fg"
    >
      <Icon name={GLYPH[theme]} className="size-[18px]" />
    </button>
  );
}
