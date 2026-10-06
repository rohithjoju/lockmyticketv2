'use client';

import { useEffect, useState } from 'react';

/**
 * A clean, self-explanatory ticket card demonstrating the 10-minute hold window.
 * Clear status, one obvious button, and zero technical clutter.
 */
export function LiveHoldSimulator() {
  const [holding, setHolding] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(600);

  useEffect(() => {
    if (!holding) return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [holding]);

  const toggleHold = () => {
    if (holding) {
      setHolding(false);
      setSecondsLeft(600);
    } else {
      setHolding(true);
      setSecondsLeft(599);
    }
  };

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="relative w-full max-w-xs sm:max-w-sm">
      {/* Ambient kinetic glow behind the ticket */}
      <div
        className={`pointer-events-none absolute -inset-3 rounded-3xl blur-2xl transition-all duration-700 ${
          holding
            ? 'animate-halo bg-gradient-to-tr from-highlight/25 via-accent/30 to-highlight/20 opacity-80'
            : 'bg-gradient-to-tr from-accent/15 via-transparent to-highlight/10 opacity-40'
        }`}
        aria-hidden
      />

      <div className="stub stub-interactive animate-float w-full shadow-2xl transition-all">
        {/* Top stub part */}
      <div className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Kochi Live Event
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
              holding
                ? 'bg-highlight text-highlight-fg'
                : 'bg-sunk text-muted'
            }`}
          >
            {holding ? 'Held for you' : 'Available'}
          </span>
        </div>

        <p className="mt-2 font-display text-xl font-bold">2 Tickets · Row C</p>
        <p className="mt-1 text-sm text-muted">
          {holding
            ? 'Your seats are locked. Nobody else can book them while you pay.'
            : 'Select tickets to reserve them exclusively for checkout.'}
        </p>

        <button
          type="button"
          onClick={toggleHold}
          className={`mt-4 w-full rounded-full py-2.5 text-xs font-semibold transition ${
            holding
              ? 'border border-line text-muted hover:text-fg'
              : 'bg-accent text-accent-fg hover:brightness-110'
          }`}
        >
          {holding ? 'Release seats' : 'Try holding a seat'}
        </button>
      </div>

      {/* Perforated tear line with countdown */}
      <div className="stub-tear flex items-center justify-between px-5 py-4">
        <div>
          <span className="block text-xs font-semibold text-fg">
            {holding ? 'Time remaining' : 'Checkout window'}
          </span>
          <span className="text-xs text-muted">to complete payment</span>
        </div>

        <span
          className={`tabular text-3xl font-bold ${
            holding ? 'text-highlight' : 'text-fg'
          }`}
        >
          {formatTimer(secondsLeft)}
        </span>
      </div>
      </div>
    </div>
  );
}
