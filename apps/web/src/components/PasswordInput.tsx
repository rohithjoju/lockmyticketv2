'use client';

import { forwardRef, useState } from 'react';
import { Icon } from './Icon';

export type PasswordInputProps = React.ComponentPropsWithoutRef<'input'> & {
  hasError?: boolean;
};

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className = '', hasError, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const [capsLockActive, setCapsLockActive] = useState(false);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      setCapsLockActive(e.getModifierState('CapsLock'));
      props.onKeyDown?.(e);
    };

    const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
      setCapsLockActive(e.getModifierState('CapsLock'));
      props.onKeyUp?.(e);
    };

    return (
      <div className="relative">
        <input
          ref={ref}
          type={showPassword ? 'text' : 'password'}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          className={`form-input w-full rounded-xl border bg-surface py-2.5 pl-3.5 pr-11 text-fg placeholder:text-muted/70 transition focus:border-accent focus:ring-0 ${
            hasError ? 'border-danger/60 focus:border-danger' : 'border-line'
          } ${className}`}
          {...props}
        />

        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          tabIndex={-1}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition hover:bg-sunk hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name={showPassword ? 'eye-off' : 'eye'} className="size-4" />
        </button>

        {capsLockActive && (
          <div
            role="status"
            className="pointer-events-none absolute right-11 top-1/2 -translate-y-1/2 rounded bg-sunk px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted"
          >
            Caps on
          </div>
        )}
      </div>
    );
  },
);

PasswordInput.displayName = 'PasswordInput';
