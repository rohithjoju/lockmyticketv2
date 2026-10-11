'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { ApiClientError } from '@/lib/apiClient';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          prompt: (notification?: (notification: unknown) => void) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, unknown>,
          ) => void;
        };
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (tokenResponse: { access_token?: string; error?: string }) => void;
            error_callback?: (err: unknown) => void;
          }) => {
            requestAccessToken: () => void;
          };
        };
      };
    };
  }
}

export function GoogleIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24">
      <path
        fill="#EA4335"
        d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.3 9 5 12 5z"
      />
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"
      />
      <path
        fill="#FBBC05"
        d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.8s.2-2.1.4-2.8L1.9 6.3C.7 8.7 0 10.3 0 12s.7 3.3 1.9 5.7l3.7-2.9z"
      />
      <path
        fill="#34A853"
        d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 16.4C3.7 20.4 7.5 23 12 23z"
      />
    </svg>
  );
}

export function AppleIcon() {
  return (
    <svg className="size-4 shrink-0 fill-current" viewBox="0 0 170 170">
      <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.69-3.04-7.69-7.85-12-14.43-6-9.13-10.74-19.38-14.23-30.74-3.48-11.36-5.23-22.18-5.23-32.48 0-14.36 3.6-26.27 10.8-35.73 7.2-9.46 16.27-14.31 27.22-14.56 4.91 0 10.42 1.34 16.53 4.02 6.11 2.68 10.15 4.07 12.11 4.18 1.48 0 5.8-1.5 12.98-4.5 7.17-3.01 13.06-4.38 17.66-4.13 13.41.67 23.91 5.37 31.5 14.11-11.75 7.15-17.5 16.85-17.26 29.11.25 9.77 4.08 17.84 11.5 24.21 7.42 6.38 16.27 10.02 26.55 10.95-2.23 7.02-4.99 14.04-8.28 21.05zM119.22 33.64c0-7.39 2.68-14.48 8.04-21.28 5.36-6.8 11.96-11.16 19.8-13.09.25 1.04.38 2.08.38 3.12 0 7.42-2.73 14.51-8.19 21.27-5.46 6.77-12.06 11.13-19.8 13.09-.08-1.04-.23-2.08-.23-3.11z" />
    </svg>
  );
}

interface OAuthButtonsProps {
  onSuccess?: () => void;
  onError?: (error: ApiClientError | null) => void;
  labelPrefix?: 'Continue' | 'Sign up' | 'Sign in';
}

export function OAuthButtons({
  onSuccess,
  onError,
  labelPrefix = 'Continue',
}: OAuthButtonsProps) {
  const { oauthLogin } = useAuth();
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);
  const tokenClientRef = useRef<{ requestAccessToken: () => void } | null>(null);

  const googleClientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    '158248754197-3ns5njh1jcvjp76ho18giavo8o71r83m.apps.googleusercontent.com';

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const setupGoogle = () => {
      // 1. Initialize Google Identity Services OAuth2 Token Client (Popup consent dialog)
      if (window.google?.accounts?.oauth2 && googleClientId) {
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: googleClientId,
          scope: 'openid email profile',
          callback: async (tokenResponse) => {
            if (tokenResponse.error) {
              setOauthLoading(null);
              return;
            }
            if (tokenResponse.access_token) {
              try {
                await oauthLogin({
                  provider: 'google',
                  accessToken: tokenResponse.access_token,
                });
                onSuccess?.();
              } catch (err) {
                onError?.(err instanceof ApiClientError ? err : null);
              } finally {
                setOauthLoading(null);
              }
            }
          },
          error_callback: () => {
            setOauthLoading(null);
          },
        });
      }

      // 2. Also register ID token handler for One-Tap fallback
      if (window.google?.accounts?.id && googleClientId) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response) => {
            setOauthLoading('google');
            onError?.(null);
            try {
              await oauthLogin({
                provider: 'google',
                idToken: response.credential,
              });
              onSuccess?.();
            } catch (err) {
              onError?.(err instanceof ApiClientError ? err : null);
            } finally {
              setOauthLoading(null);
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
      }
    };

    if (window.google?.accounts?.oauth2 || window.google?.accounts?.id) {
      setupGoogle();
    } else {
      const interval = setInterval(() => {
        if (window.google?.accounts?.oauth2 || window.google?.accounts?.id) {
          setupGoogle();
          clearInterval(interval);
        }
      }, 200);
      return () => clearInterval(interval);
    }
  }, [googleClientId, oauthLogin, onSuccess, onError]);

  const handleGoogleClick = () => {
    setOauthLoading('google');
    onError?.(null);

    // Primary: Open real Google OAuth consent popup dialog
    if (tokenClientRef.current) {
      tokenClientRef.current.requestAccessToken();
      return;
    }

    // Secondary: Try One-Tap prompt if token client is still initializing
    if (window.google?.accounts?.id) {
      window.google.accounts.id.prompt((notification: unknown) => {
        const notif = notification as { isNotDisplayed?: () => boolean; isSkippedMoment?: () => boolean };
        if (notif?.isNotDisplayed?.() || notif?.isSkippedMoment?.()) {
          setOauthLoading(null);
        }
      });
      return;
    }

    // Tertiary: Fallback if script loading is blocked
    setTimeout(() => {
      setOauthLoading(null);
      onError?.(
        new ApiClientError({
          code: 'UPSTREAM_UNAVAILABLE',
          status: 503,
          message: 'Google Sign-In is initializing. Please try again in a moment.',
          requestId: 'google_gis_init',
        }),
      );
    }, 500);
  };

  const handleAppleClick = async () => {
    setOauthLoading('apple');
    onError?.(null);

    // Apple OAuth requires paid Apple Developer credentials
    setTimeout(() => {
      setOauthLoading(null);
      onError?.(
        new ApiClientError({
          code: 'UNAUTHENTICATED',
          status: 400,
          message:
            'Apple Sign-In is currently in sandbox preview. Please sign in with Google or your email credentials.',
          requestId: 'apple_oauth_sandbox',
        }),
      );
    }, 600);
  };

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        disabled={Boolean(oauthLoading)}
        onClick={handleGoogleClick}
        className="group flex w-full items-center justify-center gap-3 rounded-full border border-line bg-surface py-2.5 px-4 text-xs font-semibold text-fg shadow-sm transition-all duration-200 hover:border-line-strong hover:bg-sunk active:scale-[0.98] disabled:opacity-60 cursor-pointer"
      >
        <GoogleIcon />
        <span>
          {oauthLoading === 'google' ? 'Connecting to Google…' : `${labelPrefix} with Google`}
        </span>
      </button>

      <button
        type="button"
        disabled={Boolean(oauthLoading)}
        onClick={handleAppleClick}
        className="group flex w-full items-center justify-center gap-3 rounded-full border border-line bg-surface py-2.5 px-4 text-xs font-semibold text-fg shadow-sm transition-all duration-200 hover:border-line-strong hover:bg-sunk active:scale-[0.98] disabled:opacity-60 cursor-pointer"
      >
        <AppleIcon />
        <span>
          {oauthLoading === 'apple' ? 'Connecting to Apple…' : `${labelPrefix} with Apple`}
        </span>
      </button>

      {/* Divider */}
      <div className="relative py-2 text-center text-xs text-muted">
        <span className="absolute inset-x-0 top-1/2 border-t border-line" aria-hidden />
        <span className="relative bg-surface px-3 font-medium uppercase tracking-wider text-[10px]">
          or with email
        </span>
      </div>
    </div>
  );
}
