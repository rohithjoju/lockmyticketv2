import type { Metadata } from 'next';
import { NextRelease } from '@/components/NextRelease';

export const metadata: Metadata = { title: 'Hosting' };

export default function OrganizerEventsPage() {
  return (
    <NextRelease
      eyebrow="Hosting"
      title="Your events, shortly"
      detail="Creating events, selling ticket types, scanning at the door and reading analytics all arrive together in the next release."
    />
  );
}
