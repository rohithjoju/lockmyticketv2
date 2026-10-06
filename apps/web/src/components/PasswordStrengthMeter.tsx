'use client';

export type PasswordStrengthProps = {
  password?: string;
};

export function PasswordStrengthMeter({ password = '' }: PasswordStrengthProps) {
  if (!password) return null;

  const hasLength = password.length >= 8;
  const hasMixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasDigitOrSpecial = /[\d\W]/.test(password);

  const score = [hasLength, hasMixedCase, hasDigitOrSpecial].filter(Boolean).length;

  const labels = ['Weak', 'Moderate', 'Strong'];
  const colors = [
    'bg-danger text-danger',
    'bg-highlight text-highlight-fg',
    'bg-emerald-500 text-emerald-500',
  ];

  return (
    <div className="mt-2 space-y-1.5" aria-live="polite">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i < score ? colors[score - 1]?.split(' ')[0] : 'bg-line'
            }`}
          />
        ))}
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>Strength: {score > 0 ? labels[score - 1] : 'Too short'}</span>
        <span>{hasLength ? '✓ 8+ chars' : 'Needs 8+ chars'}</span>
      </div>
    </div>
  );
}
