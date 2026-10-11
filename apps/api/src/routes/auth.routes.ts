import { Elysia, t } from 'elysia';
import { getEnv } from '@event-ticketing/config';
import { toEnvelope } from '../lib/errors.ts';
import { requireAuth } from '../middleware/auth.ts';
import { loginLimit } from '../middleware/rateLimit.ts';
import { requestIdPlugin } from '../middleware/requestId.ts';
import * as authService from '../services/auth.service.ts';

const env = getEnv();

const REFRESH_COOKIE = 'refresh_token';

/** httpOnly + Secure + SameSite=Lax (§8). */
const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60,
};

/** R12 — every route validates body/params/query at the boundary. */
const passwordSchema = t.String({ minLength: 8, maxLength: 128 });
const emailSchema = t.String({ format: 'email', maxLength: 255 });

export const authRoutes = new Elysia({ prefix: '/auth' })
  // Deduped by name when the server also registers it — this is here so the
  // route handlers see `requestId` in their context types.
  .use(requestIdPlugin)
  .post(
    '/register',
    async ({ body, cookie, requestId, set }) => {
      const { user, tokens } = await authService.register({
        name: body.name,
        email: body.email,
        password: body.password,
      });

      cookie[REFRESH_COOKIE]?.set({ value: tokens.refreshToken, ...refreshCookieOptions });
      set.status = 201;
      return toEnvelope({ user, accessToken: tokens.accessToken }, { requestId });
    },
    {
      // `role` is intentionally absent: registration always creates an
      // attendee (F15). An extra property here is ignored, never honoured.
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 120 }),
        email: emailSchema,
        password: passwordSchema,
      }),
    },
  )

  .post(
    '/login',
    async ({ body, cookie, requestId, server, request }) => {
      const ip =
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        server?.requestIP(request)?.address ??
        'unknown';
      await loginLimit(ip);

      const { user, tokens } = await authService.login(body);
      cookie[REFRESH_COOKIE]?.set({ value: tokens.refreshToken, ...refreshCookieOptions });
      return toEnvelope({ user, accessToken: tokens.accessToken }, { requestId });
    },
    { body: t.Object({ email: emailSchema, password: t.String({ minLength: 1 }) }) },
  )

  .post(
    '/oauth',
    async ({ body, cookie, requestId }) => {
      const { user, tokens } = await authService.oauthLogin({
        provider: body.provider,
        idToken: body.idToken,
        accessToken: body.accessToken,
        email: body.email,
        name: body.name,
      });

      cookie[REFRESH_COOKIE]?.set({ value: tokens.refreshToken, ...refreshCookieOptions });
      return toEnvelope({ user, accessToken: tokens.accessToken }, { requestId });
    },
    {
      body: t.Object({
        provider: t.Union([t.Literal('google'), t.Literal('apple')]),
        idToken: t.Optional(t.String()),
        accessToken: t.Optional(t.String()),
        email: t.Optional(emailSchema),
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
      }),
    },
  )

  .post('/refresh', async ({ cookie, requestId, body }) => {
    // Accept the token from the httpOnly cookie, or the body for non-browser
    // clients that cannot hold cookies.
    const presented = cookie[REFRESH_COOKIE]?.value ?? body?.refreshToken;
    const tokens = await authService.refresh(presented as string);
    cookie[REFRESH_COOKIE]?.set({ value: tokens.refreshToken, ...refreshCookieOptions });
    return toEnvelope({ accessToken: tokens.accessToken }, { requestId });
  }, {
    body: t.Optional(t.Object({ refreshToken: t.Optional(t.String()) })),
  })

  .use(requireAuth)
  .post('/logout', async ({ cookie, requestId }) => {
    await authService.logout(cookie[REFRESH_COOKIE]?.value as string | undefined);
    cookie[REFRESH_COOKIE]?.remove();
    return toEnvelope({ loggedOut: true }, { requestId });
  })

  .get('/me', async ({ user, requestId }) => {
    return toEnvelope(await authService.getMe(user.id), { requestId });
  });

/** Public password-reset routes (no auth guard). */
export const passwordRoutes = new Elysia({ prefix: '/auth' })
  .use(requestIdPlugin)
  .post(
    '/forgot-password',
    async ({ body, requestId }) => {
      await authService.forgotPassword(body.email);
      // Always 200 — no account enumeration (§6.3).
      return toEnvelope(
        { message: 'If that email is registered, a reset link has been sent.' },
        { requestId },
      );
    },
    { body: t.Object({ email: emailSchema }) },
  )
  .post(
    '/reset-password',
    async ({ body, requestId }) => {
      await authService.resetPassword(body);
      return toEnvelope({ reset: true }, { requestId });
    },
    { body: t.Object({ token: t.String({ minLength: 1 }), password: passwordSchema }) },
  );
