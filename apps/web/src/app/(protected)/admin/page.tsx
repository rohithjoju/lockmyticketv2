import type { Metadata } from 'next';
import { NextRelease } from '@/components/NextRelease';

export const metadata: Metadata = { title: 'Admin' };

export default function AdminPage() {
  return (
    <NextRelease
      eyebrow="Admin"
      title="Admin panels arrive next"
      detail="Users, the organizer approval queue, every event and the audit trail are already live on the API. Their screens come with the next release."
    />
  );
}
