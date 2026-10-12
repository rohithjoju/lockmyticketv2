'use client';

import { useEffect, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { type Theme } from '@/lib/theme';
import { Icon } from './Icon';

interface ThemeOption {
  value: Theme;
  label: string;
  icon: 'sun' | 'moon' | 'system';
  hint: string;
}

const OPTIONS: readonly ThemeOption[] = [
  { value: 'light', label: 'Light', icon: 'sun', hint: 'Light mode' },
  { value: 'dark', label: 'Dark', icon: 'moon', hint: 'Dark mode' },
  { value: 'system', label: 'System', icon: 'system', hint: 'Follow system appearance' },
] as const;

export function ThemeToggle() {
  const { theme, setTheme, cycle } = useTheme();
  const [isHovered, setIsHovered] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentOption = OPTIONS.find((opt) => opt.value === theme) ?? OPTIONS[0]!;

  return (
    <>
      {/* ============================================================
          1. Smaller Screen (Smartphone): Single icon switch
          ============================================================ */}
      <button
        type="button"
        aria-label={`Theme: ${currentOption.label}. Tap to change theme.`}
        title={`Theme: ${currentOption.label} (tap to change)`}
        onClick={(e) => cycle(e)}
        className="group relative grid size-9 place-items-center rounded-full border border-line bg-sunk/80 text-fg shadow-2xs backdrop-blur-sm transition-all duration-200 active:scale-95 hover:border-line-strong hover:bg-sunk sm:hidden cursor-pointer"
      >
        <Icon
          name={currentOption.icon}
          className={`size-[18px] transition-transform duration-300 group-hover:scale-110 ${
            currentOption.value === 'light'
              ? 'text-highlight'
              : currentOption.value === 'dark'
                ? 'text-accent'
                : 'text-fg'
          }`}
        />
      </button>

      {/* ============================================================
          2. Larger Screen (Laptop / Desktop):
             - Not hovered: Single icon and text switch
             - Hovered / Focused: All three icon and text options
          ============================================================ */}
      <div
        role="radiogroup"
        aria-label="Color theme"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="group/theme relative hidden sm:inline-flex items-center rounded-full border border-line bg-sunk/80 p-0.5 shadow-2xs backdrop-blur-sm transition-all duration-300 ease-out hover:border-line-strong/60 hover:shadow-xs has-[:focus-visible]:border-line-strong/60"
      >
        {OPTIONS.map((opt) => {
          const isActive = theme === opt.value;

          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={`${opt.label} mode`}
              title={isActive ? `Theme: ${opt.label} (click to cycle)` : `Switch to ${opt.label} mode`}
              tabIndex={isActive || isHovered ? 0 : -1}
              onClick={(e) => {
                if (isActive) {
                  cycle(e);
                } else {
                  setTheme(opt.value, e);
                }
              }}
              className={`group/btn relative flex items-center select-none rounded-full cursor-pointer transition-all duration-300 ease-out ${
                isActive
                  ? isHovered
                    ? 'bg-surface text-fg shadow-xs border border-line-strong/30 px-2.5 py-1 text-xs font-medium z-10'
                    : 'bg-transparent text-fg shadow-none border border-transparent px-2.5 py-1 text-xs font-medium'
                  : isHovered
                    ? 'max-w-[120px] opacity-100 scale-100 px-2.5 py-1 text-xs font-medium text-muted hover:text-fg hover:bg-surface/50 border border-transparent'
                    : 'max-w-0 opacity-0 scale-95 px-0 py-1 overflow-hidden pointer-events-none border border-transparent'
              } group-has-[:focus-visible]/theme:max-w-[120px] group-has-[:focus-visible]/theme:opacity-100 group-has-[:focus-visible]/theme:scale-100 group-has-[:focus-visible]/theme:px-2.5 group-has-[:focus-visible]/theme:pointer-events-auto ${
                isActive
                  ? 'group-has-[:focus-visible]/theme:bg-surface group-has-[:focus-visible]/theme:shadow-xs group-has-[:focus-visible]/theme:border-line-strong/30'
                  : ''
              }`}
            >
              <div className="flex items-center gap-1.5 shrink-0">
                <Icon
                  name={opt.icon}
                  className={`size-3.5 shrink-0 transition-transform duration-300 group-hover/btn:scale-110 ${
                    isActive
                      ? opt.value === 'light'
                        ? 'text-highlight'
                        : opt.value === 'dark'
                          ? 'text-accent'
                          : 'text-fg'
                      : 'text-muted group-hover/btn:text-fg'
                  }`}
                />
                <span
                  className={`whitespace-nowrap tracking-tight ${
                    isActive ? 'font-semibold text-fg' : 'font-normal text-muted group-hover/btn:text-fg'
                  }`}
                >
                  {opt.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
