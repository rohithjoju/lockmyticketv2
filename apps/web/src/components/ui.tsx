import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/* ------------------------------------------------------------------ button */

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 border-transparent',
  ghost: 'bg-transparent text-fg border-line-strong hover:bg-sunk',
  quiet: 'bg-sunk text-fg border-transparent hover:bg-surface hover:border-line',
  danger: 'bg-danger text-danger-fg hover:brightness-110 border-transparent',
};

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-full border px-5 py-2.5 ' +
  'text-sm font-medium tracking-tight transition cursor-pointer disabled:opacity-50 ' +
  'disabled:pointer-events-none disabled:cursor-not-allowed';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentPropsWithoutRef<'button'> & { variant?: Variant }) {
  return <button className={`${BUTTON_BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = 'primary',
  className = '',
  ...props
}: ComponentPropsWithoutRef<typeof Link> & { variant?: Variant }) {
  return <Link className={`${BUTTON_BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

/* ------------------------------------------------------------------- field */

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const INPUT_BASE =
  'form-input w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-fg ' +
  'placeholder:text-muted/70 transition focus:border-accent focus:ring-0';

export function Input({ className = '', ...props }: ComponentPropsWithoutRef<'input'>) {
  return <input className={`${INPUT_BASE} ${className}`} {...props} />;
}

export function Select({ className = '', ...props }: ComponentPropsWithoutRef<'select'>) {
  return <select className={`form-select ${INPUT_BASE} ${className}`} {...props} />;
}

/* ------------------------------------------------------------------- notes */

/**
 * The one place an ApiClientError becomes something readable. `title` says what
 * happened, `detail` says what to do; `requestId` is there so support can find
 * the request without the reader having to describe it.
 */
export function Notice({
  tone = 'danger',
  title,
  detail,
  requestId,
}: {
  tone?: 'danger' | 'info';
  title: string;
  detail?: string;
  requestId?: string | null;
}) {
  const accent = tone === 'danger' ? 'border-danger/40 bg-danger/8' : 'border-accent/40 bg-accent/8';
  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 ${accent}`}>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {detail ? <p className="mt-0.5 text-sm text-muted">{detail}</p> : null}
      {requestId ? <p className="tabular mt-2 text-[11px] text-muted">ref {requestId}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- badge */

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'live' | 'past' | 'off';
}) {
  const tones = {
    neutral: 'bg-sunk text-muted',
    live: 'bg-highlight text-highlight-fg',
    past: 'bg-sunk text-muted line-through decoration-1',
    off: 'bg-danger/12 text-danger',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
