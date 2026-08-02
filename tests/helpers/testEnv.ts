/**
 * Boots a throwaway PostgreSQL cluster + Redis instance, applies the auth
 * shim and all migrations, and populates process.env BEFORE any application
 * module is imported (packages/config validates at import time).
 *
 * Import this for its side effects at the very top of an integration test:
 *   import { startTestEnv, stopTestEnv } from '../helpers/testEnv.ts';
 */
import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const MIGRATIONS = join(ROOT, 'supabase/migrations');

let pgData: string | null = null;
let sockDir: string | null = null;
let redisProc: ChildProcess | null = null;
let redisContainer: string | null = null;
let redisPort = 0;
let pgPort = 0;

function run(cmd: string, args: string[], env?: Record<string, string>) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

async function waitForPort(port: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const sock = await Bun.connect({
        hostname: '127.0.0.1',
        port,
        socket: { data() {} },
      });
      sock.end();
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error(`port ${port} did not open within ${timeoutMs}ms`);
}

export type TestEnv = { databaseUrl: string; redisUrl: string };

/**
 * Idempotent: the whole test run shares one cluster (see tests/helpers/setup.ts).
 * Repeat callers join the in-flight boot instead of starting a second one.
 */
let starting: Promise<TestEnv> | null = null;

export function startTestEnv(): Promise<TestEnv> {
  starting ??= bootTestEnv();
  return starting;
}

async function bootTestEnv(): Promise<TestEnv> {
  // ---- Postgres
  pgData = mkdtempSync(join(tmpdir(), 'eticket-pg-'));
  sockDir = mkdtempSync(join(tmpdir(), 'eticket-sock-'));
  const user = process.env.USER ?? 'postgres';

  // Bun's SQL client cannot parse unix-socket connection URLs, so the test
  // cluster listens on a random loopback TCP port instead.
  pgPort = 7000 + Math.floor(Math.random() * 2000);

  run('initdb', ['-D', pgData, '-U', user, '--auth=trust', '-E', 'UTF8']);
  run('pg_ctl', [
    '-D', pgData,
    '-o', `-k ${sockDir} -c listen_addresses=127.0.0.1 -p ${pgPort}`,
    '-w', '-s', 'start',
  ]);

  const pgEnv = { PGHOST: '127.0.0.1', PGPORT: String(pgPort), PGUSER: user };
  run('createdb', ['eticket_test'], pgEnv);

  const psql = (file: string) =>
    run('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-d', 'eticket_test', '-f', file], pgEnv);

  psql(join(ROOT, 'tests/db/auth-shim.sql'));
  psql(join(MIGRATIONS, '0001_schema.sql'));
  psql(join(MIGRATIONS, '0002_functions.sql'));
  psql(join(MIGRATIONS, '0003_rls.sql'));
  psql(join(MIGRATIONS, '0004_seed.sql'));

  const databaseUrl = `postgresql://${user}@127.0.0.1:${pgPort}/eticket_test`;

  // ---- Redis: native binary if present, otherwise a throwaway container.
  redisPort = 6000 + Math.floor(Math.random() * 2000);
  const redisUrl = `redis://127.0.0.1:${redisPort}`;

  if (hasBinary('redis-server')) {
    redisProc = spawn(
      'redis-server',
      ['--port', String(redisPort), '--save', '', '--appendonly', 'no'],
      { stdio: 'ignore' },
    );
  } else if (hasBinary('docker')) {
    redisContainer = `eticket-redis-${redisPort}`;
    run('docker', [
      'run', '-d', '--rm',
      '--name', redisContainer,
      '-p', `127.0.0.1:${redisPort}:6379`,
      'redis:7-alpine',
    ]);
  } else {
    throw new Error(
      'No Redis available: install redis-server, or make docker usable, to run integration tests',
    );
  }
  await waitForPort(redisPort, 30_000);

  // ---- Env contract (§4.2) — set before app modules load.
  Object.assign(process.env, {
    NODE_ENV: 'development',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
    // Tests drive the app via app.handle(); nothing binds this port.
    API_PORT: '3001',
    WEB_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:3001',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough-32',
    QR_JWT_SECRET: 'test-qr-secret-that-is-different-32ch',
    ACCESS_TOKEN_TTL: '15m',
    REFRESH_TOKEN_TTL: '7d',
    QR_TOKEN_TTL: '24h',
    RAZORPAY_KEY_ID: 'rzp_test_key',
    RAZORPAY_KEY_SECRET: 'rzp_test_secret',
    RAZORPAY_WEBHOOK_SECRET: 'rzp_test_webhook_secret',
    CLOUDINARY_CLOUD_NAME: 'test-cloud',
    CLOUDINARY_API_KEY: 'test-cloudinary-key',
    CLOUDINARY_API_SECRET: 'test-cloudinary-secret',
    NEXT_PUBLIC_MAPBOX_TOKEN: 'pk.test',
    REDIS_URL: redisUrl,
    RESERVATION_TTL_MINUTES: '10',
    MAX_TICKETS_PER_USER_PER_EVENT: '10',
    LOGIN_MAX_ATTEMPTS: '5',
    LOGIN_LOCKOUT_MINUTES: '15',
    // Deliberately generous: every test file shares one Redis, so the
    // production value would throttle unrelated suites into failure. Rate
    // limiting is exercised by its own test, which sets the limit it needs.
    API_RATE_LIMIT_PER_MINUTE: process.env.API_RATE_LIMIT_PER_MINUTE ?? '1000',
  });

  return { databaseUrl, redisUrl };
}

function hasBinary(name: string): boolean {
  return spawnSync('which', [name], { encoding: 'utf8' }).status === 0;
}

export async function stopTestEnv(): Promise<void> {
  starting = null;
  redisProc?.kill('SIGKILL');
  redisProc = null;

  if (redisContainer) {
    spawnSync('docker', ['rm', '-f', redisContainer], { stdio: 'ignore' });
    redisContainer = null;
  }

  if (pgData && existsSync(pgData)) {
    spawnSync('pg_ctl', ['-D', pgData, '-s', '-m', 'immediate', 'stop']);
    rmSync(pgData, { recursive: true, force: true });
    pgData = null;
  }
  if (sockDir && existsSync(sockDir)) {
    rmSync(sockDir, { recursive: true, force: true });
    sockDir = null;
  }
}
