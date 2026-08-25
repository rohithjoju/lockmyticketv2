import { ButtonLink } from '@/components/ui';
import { ERROR_COPY } from '@/lib/errorCopy';

export default function NotFound() {
  const copy = ERROR_COPY.NOT_FOUND;

  return (
    <div className="mx-auto max-w-6xl px-5 py-24">
      <div className="stub mx-auto max-w-lg px-7 py-16 text-center">
        <p className="tabular text-[11px] uppercase tracking-[0.16em] text-muted">404</p>
        <h1 className="mt-3 text-3xl">{copy.title}</h1>
        <p className="mt-3 text-muted">{copy.detail}</p>
        <div className="mt-7 flex justify-center gap-3">
          <ButtonLink href="/events">Browse events</ButtonLink>
          <ButtonLink href="/" variant="ghost">
            Home
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
