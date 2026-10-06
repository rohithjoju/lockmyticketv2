'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthCard, AuthLink } from '@/components/AuthCard';
import { Button, Field, Notice } from '@/components/ui';
import { PasswordInput } from '@/components/PasswordInput';
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter';
import { ApiClientError, apiClient } from '@/lib/apiClient';

const schema = z
  .object({
    token: z.string().min(1, 'Reset token is required'),
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(128, 'Password cannot exceed 128 characters'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type Values = z.infer<typeof schema>;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [failure, setFailure] = useState<ApiClientError | null>(null);
  const [success, setSuccess] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { token },
  });

  const passwordVal = watch('password');

  async function onSubmit(values: Values) {
    setFailure(null);
    try {
      await apiClient.post('/auth/reset-password', {
        token: values.token,
        password: values.password,
      });
      setSuccess(true);
      setTimeout(() => {
        router.replace('/auth/login');
      }, 2500);
    } catch (error) {
      setFailure(error instanceof ApiClientError ? error : null);
    }
  }

  if (!token && isMounted) {
    return (
      <AuthCard
        eyebrow="Security check"
        title="Invalid link"
        intro="This password reset link is missing its security token or has already expired."
        footer={<AuthLink href="/auth/forgot-password">Request a new reset link</AuthLink>}
      >
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted">
            Password reset links expire for your account safety. Please request a fresh one.
          </p>
        </div>
      </AuthCard>
    );
  }

  if (success) {
    return (
      <AuthCard
        eyebrow="Success"
        title="Password updated"
        intro="Your password has been securely reset. Redirecting you to sign in..."
        footer={<AuthLink href="/auth/login">Proceed to sign in</AuthLink>}
      >
        <div className="rounded-xl border border-line bg-sunk/60 p-4 text-center">
          <p className="text-sm font-medium text-fg">You can now sign in with your new password.</p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="Account security"
      title="Set a new password"
      intro="Choose a strong password to protect your tickets and reservations."
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

        <input type="hidden" {...register('token')} value={token} />

        <Field label="New password" htmlFor="password" error={errors.password?.message}>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            hasError={Boolean(errors.password)}
            {...register('password')}
          />
          <PasswordStrengthMeter password={passwordVal} />
        </Field>

        <Field
          label="Confirm new password"
          htmlFor="confirmPassword"
          error={errors.confirmPassword?.message}
        >
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            hasError={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
        </Field>

        <Button type="submit" disabled={!isMounted || isSubmitting} className="w-full">
          {isSubmitting ? 'Updating password…' : 'Save new password'}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
