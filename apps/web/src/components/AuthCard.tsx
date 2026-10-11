import Link from 'next/link';

/**
 * One frame for every way in. The stub motif carries over so signing in feels
 * like part of the same box office, not a detour into a form.
 */
export function AuthCard({
  eyebrow,
  title,
  intro,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative mx-auto w-full max-w-md px-5 py-12 md:py-20">
      {/* Ambient kinetic glow behind the auth card */}
      <div
        className="pointer-events-none absolute inset-x-8 top-16 -bottom-4 rounded-[2.5rem] bg-gradient-to-tr from-accent/20 via-highlight/15 to-accent/10 blur-3xl opacity-60 animate-halo"
        aria-hidden
      />

      <div className="stub stub-interactive relative p-7 shadow-2xl backdrop-blur-sm transition-all duration-300">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
        {intro ? <p className="mt-2 text-sm text-muted">{intro}</p> : null}
        <div className="mt-7">{children}</div>
      </div>
      {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}
    </div>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
      {children}
    </Link>
  );
}
