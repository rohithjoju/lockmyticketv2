'use client';

import { use, useEffect, useRef, useState } from 'react';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { LocalTime } from '@/components/LocalTime';
import { Button } from '@/components/ui';

/* html5-qrcode is listed in SPEC §4.1 */
type ScanResult = {
  attendeeName: string;
  ticketType: string;
  verifiedAt: string;
};

type ScanHistoryEntry =
  | { status: 'success'; result: ScanResult; scannedAt: string; qrToken: string }
  | { status: 'duplicate'; message: string; scannedAt: string; qrToken: string }
  | { status: 'invalid'; message: string; scannedAt: string; qrToken: string };

type Props = { params: Promise<{ id: string }> };

const MAX_HISTORY = 50;

function ScanFeedback({ entry }: { entry: ScanHistoryEntry }) {
  if (entry.status === 'success') {
    return (
      <div className="rounded-xl border border-highlight/40 bg-highlight/10 px-4 py-3">
        <p className="font-semibold text-highlight-fg">✓ Admitted</p>
        <p className="mt-0.5 text-sm text-fg">
          {entry.result.attendeeName} · {entry.result.ticketType}
        </p>
      </div>
    );
  }
  if (entry.status === 'duplicate') {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3">
        <p className="font-semibold text-danger">⚠ Already used</p>
        <p className="mt-0.5 text-sm text-muted">{entry.message}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-sunk px-4 py-3">
      <p className="font-semibold text-muted">✕ Invalid ticket</p>
      <p className="mt-0.5 text-sm text-muted">{entry.message}</p>
    </div>
  );
}

/**
 * Epic 4.6 — Door check-in QR scanner.
 *
 * Uses html5-qrcode to access the device camera.
 * On each scan calls POST /tickets/verify with { qrToken }.
 * Instant visual feedback: green / red flash.
 * Maintains a local scan history log of the last 50 scans.
 */
export default function DoorScanPage({ params }: Props) {
  const { id } = use(params);
  const scannerRef = useRef<unknown>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<ScanHistoryEntry | null>(null);
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const processingRef = useRef(false);

  async function handleScan(decodedText: string) {
    if (processingRef.current) return;
    processingRef.current = true;

    const qrToken = decodedText.trim();
    const scannedAt = new Date().toISOString();

    try {
      const { data } = await apiClient.post<ScanResult>('/tickets/verify', { qrToken });
      const entry: ScanHistoryEntry = { status: 'success', result: data, scannedAt, qrToken };
      setLastResult(entry);
      setHistory((h) => [entry, ...h].slice(0, MAX_HISTORY));

      // Brief audio beep for success (using Web Audio API)
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch {
        // Audio is best-effort
      }
    } catch (err) {
      let status: 'duplicate' | 'invalid' = 'invalid';
      let message = 'Invalid or tampered ticket.';

      if (err instanceof ApiClientError) {
        if (err.code === 'TICKET_ALREADY_USED') {
          status = 'duplicate';
          message = err.detail;
        } else {
          message = err.detail;
        }
      }

      const entry: ScanHistoryEntry = { status, message, scannedAt, qrToken };
      setLastResult(entry);
      setHistory((h) => [entry, ...h].slice(0, MAX_HISTORY));
    } finally {
      // Debounce: wait 2s before accepting the next scan
      setTimeout(() => {
        processingRef.current = false;
      }, 2000);
    }
  }

  async function startScanner() {
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (!containerRef.current) return;

      const scanner = new Html5Qrcode('qr-scanner-container');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText: string) => void handleScan(decodedText),
        () => {
          /* Ignore QR scanning frame errors */
        },
      );
      setIsRunning(true);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not access camera. Make sure you have granted camera permissions.',
      );
    }
  }

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        const scanner = scannerRef.current as { stop: () => Promise<void>; clear: () => void };
        await scanner.stop();
        scanner.clear();
      } catch {
        // Ignore stop errors
      }
      scannerRef.current = null;
    }
    setIsRunning(false);
  }

  useEffect(() => {
    return () => {
      void stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-xl px-5 py-10 md:py-14">
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Door scanner
        </p>
        <h1 className="mt-2 text-4xl">Scan tickets</h1>
      </header>

      {/* Camera viewfinder */}
      <div className="stub overflow-hidden">
        <div
          ref={containerRef}
          id="qr-scanner-container"
          className="min-h-64 bg-black"
          aria-label="Camera viewfinder for QR scanning"
        />
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      <div className="mt-4 flex gap-3">
        {!isRunning ? (
          <Button className="flex-1" onClick={() => void startScanner()}>
            Start camera
          </Button>
        ) : (
          <Button variant="ghost" className="flex-1" onClick={() => void stopScanner()}>
            Stop camera
          </Button>
        )}
      </div>

      {/* Last scan result */}
      {lastResult && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Last scan
          </p>
          <ScanFeedback entry={lastResult} />
        </div>
      )}

      {/* Scan history */}
      {history.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent scans</h2>
            <span className="tabular text-xs text-muted">{history.length} / {MAX_HISTORY}</span>
          </div>
          <div className="space-y-2">
            {history.map((entry, i) => (
              <div
                key={`${entry.qrToken}-${i}`}
                className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-sm ${
                  entry.status === 'success'
                    ? 'bg-highlight/10'
                    : entry.status === 'duplicate'
                      ? 'bg-danger/8'
                      : 'bg-sunk'
                }`}
              >
                <div className="min-w-0">
                  <span className="font-medium">
                    {entry.status === 'success'
                      ? `${entry.result.attendeeName} · ${entry.result.ticketType}`
                      : entry.status === 'duplicate'
                        ? 'Already used'
                        : 'Invalid ticket'}
                  </span>
                </div>
                <span className="tabular ml-3 shrink-0 text-xs text-muted">
                  <LocalTime iso={entry.scannedAt} />
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
