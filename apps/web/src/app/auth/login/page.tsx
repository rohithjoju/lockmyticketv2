'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthCard, AuthLink } from '@/components/AuthCard';
import { Button, Field, Input, Notice } from '@/components/ui';
import { PasswordInput } from '@/components/PasswordInput';
import { OAuthButtons } from '@/components/OAuthButtons';
import { useAuth } from '@/hooks/useAuth';
import { ApiClientError } from '@/lib/apiClient';
import { RETURN_PARAM, safeReturnTo } from '@/lib/returnTo';

const schema = z.object({
  email: z.string().min(1, 'Enter your email').email('That does not look like an email'),
  password: z.string().min(1, 'Enter your password'),
  rememberMe: z.boolean().optional(),
});

type Values = z.infer<typeof schema>;

type SavedProfile = {
  name: string;
  email: string;
  role: string;
};

function LoginForm() {
  const { signIn, state } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [failure, setFailure] = useState<ApiClientError | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  // "Continue as" saved profile support
  const [savedUser, setSavedUser] = useState<SavedProfile | null>(null);
  const [useEmailFallback, setUseEmailFallback] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    try {
      const stored = localStorage.getItem('lmt_saved_user');
      if (stored) {
        setSavedUser(JSON.parse(stored));
      }
    } catch {}
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
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { rememberMe: true },
  });

  const handleContinueAs = (email: string) => {
    setValue('email', email);
    setUseEmailFallback(true);
  };

  async function onSubmit(values: Values) {
    setFailure(null);
    try {
      await signIn({ email: values.email, password: values.password });
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
      <div className="space-y-6">
        {failure ? (
          <Notice title={failure.title} detail={failure.detail} requestId={failure.requestId} />
        ) : null}

        {/* 1. Fast-Track: "Continue as [User]" (if previously signed in) */}
        {savedUser && !useEmailFallback && (
          <div className="animate-in fade-in zoom-in-95 duration-300 rounded-2xl border border-line bg-sunk/50 p-4 transition-all">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-full bg-highlight font-display text-base font-black text-highlight-fg shadow-sm">
                {savedUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-fg">{savedUser.name}</p>
                <p className="truncate text-xs text-muted">{savedUser.email}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleContinueAs(savedUser.email)}
              className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-xs font-semibold text-accent-fg shadow-md transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
            >
              Continue as {savedUser.name.split(' ')[0]} →
            </button>

            <button
              type="button"
              onClick={() => setUseEmailFallback(true)}
              className="mt-2.5 w-full text-center text-xs text-muted transition hover:text-fg"
            >
              Use a different account
            </button>
          </div>
        )}

        {/* 2. One-Tap OAuth Options */}
        {(!savedUser || useEmailFallback) && (
          <OAuthButtons
            labelPrefix="Continue"
            onSuccess={() => router.replace(returnTo)}
            onError={(err) => setFailure(err)}
          />
        )}

        {/* 3. Credentials Email / Password Form */}
        {(!savedUser || useEmailFallback) && (
          <form
            method="POST"
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <Field label="Email" htmlFor="email" error={errors.email?.message}>
              <Input
                id="email"
                type="email"
                autoComplete="username email"
                placeholder="you@example.com"
                aria-invalid={Boolean(errors.email)}
                {...register('email')}
              />
            </Field>

            <Field label="Password" htmlFor="password" error={errors.password?.message}>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                placeholder="••••••••"
                aria-invalid={Boolean(errors.password)}
                hasError={Boolean(errors.password)}
                {...register('password')}
              />
            </Field>

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 cursor-pointer select-none text-muted hover:text-fg">
                <input
                  type="checkbox"
                  className="form-checkbox size-3.5 rounded border-line bg-surface text-accent focus:ring-accent"
                  {...register('rememberMe')}
                />
                <span>Remember this device</span>
              </label>

              <AuthLink href="/auth/forgot-password">Forgot password?</AuthLink>
            </div>

            <Button
              type="submit"
              disabled={!isMounted || isSubmitting || state === 'authenticated'}
              className="w-full transition-transform active:scale-[0.98]"
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}
      </div>
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
