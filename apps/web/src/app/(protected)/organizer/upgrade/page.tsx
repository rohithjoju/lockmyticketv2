import type { Metadata } from 'next';
import { NextRelease } from '@/components/NextRelease';

export const metadata: Metadata = { title: 'Host an event' };

export default function OrganizerUpgradePage() {
  return (
    <NextRelease
      eyebrow="Hosting"
      title="Organizer applications open next"
      detail="The API already takes applications and KYC documents. The form for them lands with the organizer dashboards in the next release."
    />
  );
}
