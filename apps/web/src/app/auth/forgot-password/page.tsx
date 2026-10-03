'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthCard, AuthLink } from '@/components/AuthCard';
import { Button, Field, Input, Notice } from '@/components/ui';
import { ApiClientError, apiClient } from '@/lib/apiClient';

const schema = z.object({
  email: z.string().min(1, 'Enter your email').email('That does not look like an email'),
});

type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<ApiClientError | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setFailure(null);
    try {
      await apiClient.post('/auth/forgot-password', values);
      setSent(true);
    } catch (error) {
      setFailure(error instanceof ApiClientError ? error : null);
    }
  }

  if (sent) {
    return (
      <AuthCard
        eyebrow="Password reset"
        title="Check your inbox"
        intro="If that email has an account, a reset link is on its way. The link is good for one use."
        footer={<AuthLink href="/auth/login">Back to sign in</AuthLink>}
      >
        <p className="text-sm text-muted">
          Nothing after a few minutes? Check spam, then try again — the address may be spelled
          differently to how it was registered.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="Password reset"
      title="Send me a reset link"
      intro="We will email a one-time link to set a new password."
      footer={<AuthLink href="/auth/login">Back to sign in</AuthLink>}
    >
      <form
        method="POST"
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-5"
        noValidate
      >
        {failure ? (
          <Notice title={failure.title} detail={failure.detail} requestId={failure.requestId} />
        ) : null}

        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </Field>

        <Button type="submit" disabled={!isMounted || isSubmitting} className="w-full">
          {isSubmitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthCard>
  );
}
