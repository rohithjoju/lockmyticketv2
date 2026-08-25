import { ButtonLink } from './ui';

/**
 * A landing spot for a nav destination whose screens arrive in Phase 7.
 *
 * It exists so the role-aware nav never points at a 404. It says plainly that
 * the screen is not built yet rather than showing an empty state that implies
 * the reader has no events or no users to manage.
 */
export function NextRelease({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
      <div className="stub mx-auto max-w-lg px-7 py-14 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          {eyebrow}
        </p>
        <h1 className="mt-3 text-3xl">{title}</h1>
        <p className="mt-3 text-muted">{detail}</p>
        <div className="mt-7 flex justify-center">
          <ButtonLink href="/dashboard" variant="ghost">
            Back to your tickets
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
