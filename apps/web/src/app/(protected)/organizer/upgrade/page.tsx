'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Metadata } from 'next';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { useAuth } from '@/hooks/useAuth';
import { Button, Field, Input, Notice } from '@/components/ui';

/**
 * Epic 3.1 — Organizer upgrade / application form.
 *
 * Sends POST /organizers/upgrade as multipart/form-data.
 * Client-side guards:
 *   - All required fields validated before submit.
 *   - KYC PDF: magic-byte check (%PDF-), max 10 MB.
 * On success: refreshes user profile and redirects to /dashboard.
 */
export default function OrganizerUpgradePage() {
  const router = useRouter();
  const { reload, user } = useAuth();

  const [orgName, setOrgName] = useState('');
  const [contact, setContact] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [kycFile, setKycFile] = useState<File | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If already an organizer (any status), redirect to status page
  if (user?.organizer) {
    router.replace('/organizer/status');
    return null;
  }

  function validateMagicBytes(file: File): Promise<boolean> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const arr = new Uint8Array(reader.result as ArrayBuffer).slice(0, 5);
        const header = Array.from(arr)
          .map((b) => String.fromCharCode(b))
          .join('');
        resolve(header === '%PDF-');
      };
      reader.onerror = () => resolve(false);
      reader.readAsArrayBuffer(file.slice(0, 5));
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setSubmitError(null);

    const errors: Record<string, string> = {};
    if (orgName.trim().length < 2) errors.orgName = 'Must be at least 2 characters.';
    if (!/^\d{10}$/.test(contact)) errors.contact = 'Must be exactly 10 digits.';
    if (description.trim().length < 20) errors.description = 'Must be at least 20 characters.';
    if (!kycFile) {
      errors.kycFile = 'A KYC document is required.';
    } else if (kycFile.size > 10 * 1024 * 1024) {
      errors.kycFile = 'File must be under 10 MB.';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    // Magic byte validation
    if (kycFile) {
      const isValidPdf = await validateMagicBytes(kycFile);
      if (!isValidPdf) {
        setFieldErrors({ kycFile: 'File must be a valid PDF (magic bytes %PDF-).' });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const form = new FormData();
      form.append('organizationName', orgName.trim());
      form.append('contactNumber', contact);
      form.append('address', address.trim());
      form.append('description', description.trim());
      if (kycFile) form.append('kycDocument', kycFile);

      await apiClient.post('/organizers/upgrade', form);
      await reload();
      router.push('/organizer/status');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSubmitError(err.detail);
      } else {
        setSubmitError('Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-5 py-10 md:py-14">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Hosting</p>
        <h1 className="mt-2 text-4xl">Apply to host events</h1>
        <p className="mt-3 text-muted">
          Submit your organization details and a KYC document. An admin will review and approve
          your application within 48 hours.
        </p>
      </header>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5" noValidate>
        <Field
          label="Organization name"
          htmlFor="org-name"
          error={fieldErrors.orgName}
        >
          <Input
            id="org-name"
            required
            minLength={2}
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="e.g. Bandstand Events"
            aria-describedby={fieldErrors.orgName ? 'org-name-error' : undefined}
          />
        </Field>

        <Field
          label="Contact number"
          htmlFor="contact"
          hint="10-digit Indian mobile number, no spaces"
          error={fieldErrors.contact}
        >
          <Input
            id="contact"
            type="tel"
            required
            maxLength={10}
            value={contact}
            onChange={(e) => setContact(e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="9876543210"
            aria-describedby={fieldErrors.contact ? 'contact-error' : undefined}
          />
        </Field>

        <Field label="Address" htmlFor="address" hint="Optional">
          <Input
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, Mumbai"
          />
        </Field>

        <Field
          label="Description"
          htmlFor="description"
          hint="Describe what kind of events you organize (min 20 chars)"
          error={fieldErrors.description}
        >
          <textarea
            id="description"
            required
            minLength={20}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="We run cultural festivals, concerts, and workshops across major Indian cities."
            className="form-input w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-fg placeholder:text-muted/70 transition focus:border-accent focus:ring-0 resize-none"
            aria-describedby={fieldErrors.description ? 'description-error' : undefined}
          />
        </Field>

        <Field
          label="KYC document"
          htmlFor="kyc-doc"
          hint="PDF only · max 10 MB"
          error={fieldErrors.kycFile}
        >
          <input
            id="kyc-doc"
            type="file"
            required
            accept=".pdf,application/pdf"
            onChange={(e) => setKycFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-sunk file:px-4 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-surface"
            aria-describedby={fieldErrors.kycFile ? 'kyc-doc-error' : undefined}
          />
        </Field>

        {submitError && (
          <Notice title="Could not submit application" detail={submitError} />
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : 'Submit application'}
        </Button>
      </form>
    </div>
  );
}
