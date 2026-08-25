'use client';

import { useEffect } from 'react';
import { Button, ButtonLink, Notice } from '@/components/ui';
import { ApiClientError } from '@/lib/apiClient';
import { copyFor } from '@/lib/errorCopy';

/**
 * The last stop before a raw stack trace would reach a reader.
 *
 * An ApiClientError already carries copy derived from its ErrorCode; anything
 * else is treated as INTERNAL_ERROR, whose message is never shown (§8). The
 * digest is the only technical string on the page, and it is there so support
 * can find the request.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- the browser console is the only sink here
    console.error(error);
  }, [error]);

  const known = error instanceof ApiClientError;
  const copy = known ? { title: error.title, detail: error.detail } : copyFor('INTERNAL_ERROR');
  const reference = known ? error.requestId : (error.digest ?? null);

  return (
    <div className="mx-auto max-w-lg px-5 py-24">
      <Notice title={copy.title} detail={copy.detail} requestId={reference} />
      <div className="mt-6 flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/events" variant="ghost">
          Browse events
        </ButtonLink>
      </div>
    </div>
  );
}
