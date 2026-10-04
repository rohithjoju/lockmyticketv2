'use client';

import type { Metadata } from 'next';
import { EventForm } from '@/components/EventForm';

export default function CreateEventPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10 md:py-14">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Hosting
        </p>
        <h1 className="mt-2 text-4xl">Create event</h1>
      </header>
      <EventForm />
    </div>
  );
}
