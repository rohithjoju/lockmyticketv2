'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { isActive, navItemsFor } from '@/lib/nav';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';

function Wordmark() {
  return (
    <Link href="/" className="group flex items-baseline gap-[3px] font-display text-[19px] font-extrabold tracking-[-0.05em]">
      <span>lock</span>
      <span aria-hidden className="mb-[3px] size-[5px] shrink-0 self-end rounded-full bg-highlight transition group-hover:scale-125" />
      <span>my</span>
      <span aria-hidden className="mb-[3px] size-[5px] shrink-0 self-end rounded-full bg-highlight transition group-hover:scale-125" />
      <span>ticket</span>
    </Link>
  );
}

function AccountControl() {
  const { user, state, signOut } = useAuth();

  if (state === 'loading') {
    return <span className="size-9 animate-pulse rounded-full bg-sunk" aria-hidden />;
  }

  if (!user) {
    return (
      <Link
        href="/auth/login"
        className="rounded-full border border-line-strong px-4 py-1.5 text-sm font-medium transition hover:bg-sunk"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-muted sm:inline">{user.name.split(' ')[0]}</span>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition hover:border-line-strong hover:text-fg"
      >
        Sign out
      </button>
    </div>
  );
}

/**
 * The rail. Desktop puts every destination in the header; below `md` the
 * primary ones move to a fixed bottom bar, which is where a thumb already is
 * when someone is standing in a venue queue.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const items = navItemsFor(user);
  const rail = items.filter((item) => item.primary);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Wordmark />

          <nav aria-label="Main" className="ml-2 hidden items-center gap-1 md:flex">
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive(item.href, pathname) ? 'page' : undefined}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  isActive(item.href, pathname)
                    ? 'bg-sunk text-fg'
                    : 'text-muted hover:text-fg'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <AccountControl />
          </div>
        </div>
      </header>

      <main className="flex-1 pb-24 md:pb-0">{children}</main>

      <footer className="hidden border-t border-line py-8 md:block">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 text-sm text-muted">
          <span>Tickets held for 10 minutes. Pay within the window and they are yours.</span>
          <span className="tabular text-xs">v1.0</span>
        </div>
      </footer>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <ul className="mx-auto flex max-w-md">
          {rail.map((item) => {
            const active = isActive(item.href, pathname);
            return (
              <li key={item.key} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                    active ? 'text-fg' : 'text-muted'
                  }`}
                >
                  <span
                    className={`grid h-7 w-12 place-items-center rounded-full transition ${
                      active ? 'bg-highlight text-highlight-fg' : ''
                    }`}
                  >
                    <Icon name={item.icon} className="size-[18px]" />
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
