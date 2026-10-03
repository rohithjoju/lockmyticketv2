'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthCard, AuthLink } from '@/components/AuthCard';
import { Button, Field, Input, Notice } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { ApiClientError } from '@/lib/apiClient';
import { RETURN_PARAM, safeReturnTo } from '@/lib/returnTo';

const schema = z.object({
  email: z.string().min(1, 'Enter your email').email('That does not look like an email'),
  password: z.string().min(1, 'Enter your password'),
});

type Values = z.infer<typeof schema>;

function LoginForm() {
  const { signIn, state } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [failure, setFailure] = useState<ApiClientError | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const returnTo = safeReturnTo(params.get(RETURN_PARAM));

  useEffect(() => {
    if (state === 'authenticated') {
      router.replace(returnTo);
    }
  }, [state, router, returnTo]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setFailure(null);
    try {
      await signIn(values);
      router.replace(returnTo);
    } catch (error) {
      setFailure(error instanceof ApiClientError ? error : null);
    }
  }

  return (
    <AuthCard
      eyebrow="Box office"
      title="Sign in"
      intro="Your tickets, your holds, and anything you are hosting."
      footer={
        <>
          No account yet? <AuthLink href="/auth/register">Create one</AuthLink>
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

        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
        </Field>

        <Button type="submit" disabled={!isMounted || isSubmitting || state === 'authenticated'} className="w-full">
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className="text-center text-sm">
          <AuthLink href="/auth/forgot-password">Forgot your password?</AuthLink>
        </p>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
