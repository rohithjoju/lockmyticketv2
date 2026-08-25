'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SessionUserDto } from '@event-ticketing/types';
import {
  api,
  apiClient,
  setAccessToken,
  setSessionLostHandler,
} from '@/lib/apiClient';

export type SessionState = 'loading' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  user: SessionUserDto | null;
  state: SessionState;
  signIn: (input: { email: string; password: string }) => Promise<SessionUserDto>;
  register: (input: { name: string; email: string; password: string }) => Promise<SessionUserDto>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type LoginResponse = { user: SessionUserDto; accessToken: string };

/**
 * Holds the session for the whole client tree.
 *
 * The access token never touches storage — it lives in the apiClient module.
 * What survives a reload is the httpOnly refresh cookie, so booting means
 * spending one refresh: if it works we have a session, if it 401s we are
 * anonymous. That is also why there is no flash of the signed-in shell for a
 * signed-out reader; `state` stays 'loading' until the answer is in.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUserDto | null>(null);
  const [state, setState] = useState<SessionState>('loading');

  const loadMe = useCallback(async () => {
    const { data } = await apiClient.get<SessionUserDto>('/auth/me');
    setUser(data);
    setState('authenticated');
  }, []);

  useEffect(() => {
    let cancelled = false;

    // A refresh that fails anywhere below here means "no session", not "error".
    void (async () => {
      try {
        const { data } = await api<{ accessToken: string }>('/auth/refresh', { method: 'POST' });
        setAccessToken(data.accessToken);
        if (cancelled) return;
        await loadMe();
      } catch {
        if (cancelled) return;
        setAccessToken(null);
        setUser(null);
        setState('anonymous');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  // apiClient calls this when a refresh fails mid-session, so an expired
  // session empties the UI once rather than each component discovering it.
  useEffect(() => {
    setSessionLostHandler(() => {
      setUser(null);
      setState('anonymous');
    });
    return () => setSessionLostHandler(null);
  }, []);

  const signIn = useCallback(async (input: { email: string; password: string }) => {
    const { data } = await apiClient.post<LoginResponse>('/auth/login', input);
    setAccessToken(data.accessToken);
    setUser(data.user);
    setState('authenticated');
    return data.user;
  }, []);

  const register = useCallback(
    async (input: { name: string; email: string; password: string }) => {
      const { data } = await apiClient.post<LoginResponse>('/auth/register', input);
      setAccessToken(data.accessToken);
      setUser(data.user);
      setState('authenticated');
      return data.user;
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout');
    } finally {
      // Even a failed logout call must clear this tab. The refresh token is
      // denylisted server-side on the next use either way.
      setAccessToken(null);
      setUser(null);
      setState('anonymous');
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      await loadMe();
    } catch {
      setUser(null);
      setState('anonymous');
    }
  }, [loadMe]);

  const value = useMemo(
    () => ({ user, state, signIn, register, signOut, reload }),
    [user, state, signIn, register, signOut, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
