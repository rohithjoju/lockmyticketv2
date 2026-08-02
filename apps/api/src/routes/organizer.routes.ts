import { Elysia, t } from 'elysia';
import { toEnvelope } from '../lib/errors.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requestIdPlugin } from '../middleware/requestId.ts';
import * as organizerService from '../services/organizer.service.ts';

/**
 * §6.3 /organizers/*. Routes validate and delegate; every rule about who may
 * become an organizer lives in the service and, ultimately, in the
 * `verification_status` the admin controls.
 */
export const organizerRoutes = new Elysia({ prefix: '/organizers' })
  .use(requestIdPlugin)
  .use(requireAuth)

  .post(
    '/upgrade',
    async ({ body, user, requestId, set }) => {
      const organizer = await organizerService.applyForOrganizer(
        user,
        {
          organizationName: body.organizationName,
          contactNumber: body.contactNumber,
          address: body.address,
          description: body.description,
        },
        body.kycDocument,
      );
      set.status = 201;
      return toEnvelope(organizer, { requestId });
    },
    {
      // The declared content type is not trusted: the service re-checks the
      // %PDF- magic bytes and the 10MB limit before anything is uploaded (§8).
      body: t.Object({
        organizationName: t.String({ minLength: 2, maxLength: 200 }),
        contactNumber: t.String({ minLength: 10, maxLength: 15 }),
        address: t.Optional(t.String({ maxLength: 500 })),
        description: t.Optional(t.String({ maxLength: 5_000 })),
        kycDocument: t.File(),
      }),
      type: 'multipart/form-data',
    },
  )

  .get('/me', async ({ user, requestId }) =>
    toEnvelope(await organizerService.getMyOrganizer(user), { requestId }),
  )

  .patch(
    '/me',
    async ({ body, user, requestId }) =>
      toEnvelope(await organizerService.updateMyOrganizer(user, body), { requestId }),
    {
      body: t.Partial(
        t.Object({
          organizationName: t.String({ minLength: 2, maxLength: 200 }),
          contactNumber: t.String({ minLength: 10, maxLength: 15 }),
          address: t.String({ maxLength: 500 }),
          description: t.String({ maxLength: 5_000 }),
        }),
      ),
    },
  );
