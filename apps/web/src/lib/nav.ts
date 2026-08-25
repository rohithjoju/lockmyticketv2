import type { SessionUserDto } from '@event-ticketing/types';

/** Exactly what GET /auth/me returns. */
export type SessionUser = SessionUserDto;

export type IconName = 'compass' | 'stub' | 'stage' | 'shield' | 'enter' | 'plus';

export type NavItem = {
  key: string;
  href: string;
  label: string;
  icon: IconName;
  /** Shown in the mobile bottom rail. Desktop shows everything. */
  primary: boolean;
};

/**
 * The nav is the third of the three role checks (RLS · middleware · UI, R4).
 * It is the weakest one by design — hiding a link is a courtesy, not a
 * control — so the rule here mirrors the one the API actually enforces:
 * organizer surfaces open on `verification_status = 'approved'`, not on the
 * role string, because that is the check behind ORGANIZER_NOT_APPROVED.
 */
export function navItemsFor(user: SessionUser | null): NavItem[] {
  const items: NavItem[] = [
    { key: 'browse', href: '/events', label: 'Browse', icon: 'compass', primary: true },
  ];

  if (!user) {
    items.push({ key: 'signin', href: '/auth/login', label: 'Sign in', icon: 'enter', primary: true });
    return items;
  }

  items.push({ key: 'tickets', href: '/dashboard', label: 'My tickets', icon: 'stub', primary: true });

  const isApprovedOrganizer = user.organizer?.verificationStatus === 'approved';

  if (isApprovedOrganizer) {
    items.push({
      key: 'organizer',
      href: '/organizer/events',
      label: 'Hosting',
      icon: 'stage',
      primary: true,
    });
  } else {
    items.push({
      key: 'upgrade',
      href: '/organizer/upgrade',
      label: 'Host an event',
      icon: 'plus',
      primary: false,
    });
  }

  if (user.role === 'admin') {
    items.push({ key: 'admin', href: '/admin', label: 'Admin', icon: 'shield', primary: true });
  }

  return items;
}

/** Marks the rail item for the current URL, matching nested routes too. */
export function isActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
