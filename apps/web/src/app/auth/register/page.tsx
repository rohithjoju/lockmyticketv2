'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthCard, AuthLink } from '@/components/AuthCard';
import { Button, Field, Input, Notice } from '@/components/ui';
import { PasswordInput } from '@/components/PasswordInput';
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter';
import { useAuth } from '@/hooks/useAuth';
import { ApiClientError } from '@/lib/apiClient';
import { RETURN_PARAM, safeReturnTo } from '@/lib/returnTo';

/** Client registration schema with password confirmation matching. */
const schema = z
  .object({
    name: z.string().trim().min(1, 'Tell us what to call you').max(120, 'That is a bit long'),
    email: z.string().min(1, 'Enter your email').email('That does not look like an email'),
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(128, 'Passwords cap out at 128 characters'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
    termsAccepted: z.literal(true, {
      errorMap: () => ({ message: 'Please agree to the Terms of Service' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type Values = z.infer<typeof schema>;

function RegisterForm() {
  const { register: createAccount } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [failure, setFailure] = useState<ApiClientError | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const passwordVal = watch('password');

  async function onSubmit(values: Values) {
    setFailure(null);
    try {
      // Role is not sent and would be ignored if it were: registration always
      // creates an attendee, server-side (F15).
      await createAccount({
        name: values.name,
        email: values.email,
        password: values.password,
      });
      router.replace(safeReturnTo(params.get(RETURN_PARAM)));
    } catch (error) {
      setFailure(error instanceof ApiClientError ? error : null);
    }
  }

  return (
    <AuthCard
      eyebrow="First time here"
      title="Create your account"
      intro="You will need one to hold tickets. It takes about twenty seconds."
      footer={
        <>
          Already registered? <AuthLink href="/auth/login">Sign in</AuthLink>
        </>
      }
    >
      <form
        method="POST"
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
      >
        {failure ? (
          <Notice title={failure.title} detail={failure.detail} requestId={failure.requestId} />
        ) : null}

        <Field label="Name" htmlFor="name" error={errors.name?.message}>
          <Input
            id="name"
            autoComplete="name"
            placeholder="Your full name"
            aria-invalid={Boolean(errors.name)}
            {...register('name')}
          />
        </Field>

        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            hasError={Boolean(errors.password)}
            {...register('password')}
          />
          <PasswordStrengthMeter password={passwordVal} />
        </Field>

        <Field
          label="Confirm password"
          htmlFor="confirmPassword"
          error={errors.confirmPassword?.message}
        >
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirmPassword)}
            hasError={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
        </Field>

        <div className="pt-1">
          <label className="flex items-start gap-2.5 cursor-pointer text-xs text-muted select-none">
            <input
              type="checkbox"
              className="form-checkbox mt-0.5 size-3.5 rounded border-line bg-surface text-accent focus:ring-accent"
              {...register('termsAccepted')}
            />
            <span>
              I agree to the{' '}
              <span className="text-fg underline decoration-line-strong underline-offset-2">
                Terms of Service
              </span>{' '}
              and{' '}
              <span className="text-fg underline decoration-line-strong underline-offset-2">
                Privacy Policy
              </span>
              .
            </span>
          </label>
          {errors.termsAccepted?.message && (
            <p className="mt-1 text-xs text-danger">{errors.termsAccepted.message}</p>
          )}
        </div>

        <Button type="submit" disabled={!isMounted || isSubmitting} className="w-full mt-2">
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
