#!/usr/bin/env bash
# Boot a throwaway PostgreSQL cluster, apply the auth shim + all migrations,
# then run the SQL file / command passed as "$@" against it. Tears down on exit.
#
#   tests/db/ephemeral-pg.sh path/to/checks.sql
#   tests/db/ephemeral-pg.sh -c "select 1"
#
# Set SEED=0 to skip 0004_seed.sql. Set KEEP=1 to leave the cluster running
# (prints PGHOST/PGPORT for manual inspection).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
SHIM="$ROOT/tests/db/auth-shim.sql"
SEED="${SEED:-1}"

PGDATA="$(mktemp -d /tmp/eticket-pg.XXXXXX)"
SOCKDIR="$(mktemp -d /tmp/eticket-sock.XXXXXX)"
export PGHOST="$SOCKDIR"
export PGDATABASE="eticket_test"
export PGUSER="$(id -un)"

cleanup() {
  if [[ "${KEEP:-0}" != "1" ]]; then
    pg_ctl -D "$PGDATA" -s -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$PGDATA" "$SOCKDIR"
  fi
}
trap cleanup EXIT

initdb -D "$PGDATA" -U "$PGUSER" --auth=trust -E UTF8 >/dev/null
pg_ctl -D "$PGDATA" -o "-k $SOCKDIR -c listen_addresses=''" -w -s start >/dev/null
createdb "$PGDATABASE"

run() { psql -v ON_ERROR_STOP=1 -q "$@"; }

run -f "$SHIM"
run -f "$MIGRATIONS/0001_schema.sql"
run -f "$MIGRATIONS/0002_functions.sql"
run -f "$MIGRATIONS/0003_rls.sql"
if [[ "$SEED" == "1" ]]; then run -f "$MIGRATIONS/0004_seed.sql"; fi

echo ">>> migrations applied cleanly to fresh database"

if [[ "${KEEP:-0}" == "1" ]]; then
  echo "KEEP=1 — cluster left running. PGHOST=$PGHOST PGDATABASE=$PGDATABASE"
  trap - EXIT
  exit 0
fi

if [[ "$#" -gt 0 ]]; then
  psql -v ON_ERROR_STOP=1 "$@"
fi
