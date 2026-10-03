'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthCard, AuthLink } from '@/components/AuthCard';
import { Button, Field, Input, Notice } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { ApiClientError } from '@/lib/apiClient';
import { RETURN_PARAM, safeReturnTo } from '@/lib/returnTo';

/** Mirrors the API's boundary schema (§6.3 POST /auth/register). */
const schema = z.object({
  name: z.string().trim().min(1, 'Tell us what to call you').max(120, 'That is a bit long'),
  email: z.string().min(1, 'Enter your email').email('That does not look like an email'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(128, 'Passwords cap out at 128 characters'),
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
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setFailure(null);
    try {
      // Role is not sent and would be ignored if it were: registration always
      // creates an attendee, server-side (F15).
      await createAccount(values);
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
        className="space-y-5"
        noValidate
      >
        {failure ? (
          <Notice title={failure.title} detail={failure.detail} requestId={failure.requestId} />
        ) : null}

        <Field label="Name" htmlFor="name" error={errors.name?.message}>
          <Input
            id="name"
            autoComplete="name"
            aria-invalid={Boolean(errors.name)}
            {...register('name')}
          />
        </Field>

        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          hint="At least 8 characters."
          error={errors.password?.message}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
        </Field>

        <Button type="submit" disabled={!isMounted || isSubmitting} className="w-full">
          {isSubmitting ? 'Creating…' : 'Create account'}
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
