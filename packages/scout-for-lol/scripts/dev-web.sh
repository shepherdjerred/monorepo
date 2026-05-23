#!/usr/bin/env bash
#
# Spin up Scout's web UI locally end-to-end:
#   - Migrates a local SQLite DB
#   - Boots the backend on :3000 (logs in as the BETA Discord bot)
#   - Boots the Vite dev server on :5180 (proxies /trpc + /api to backend)
#
# Run from anywhere via either of:
#   op run --env-file=packages/scout-for-lol/dev-web.env.tpl \
#       -- ./packages/scout-for-lol/scripts/dev-web.sh
#   bun run --filter='./packages/scout-for-lol' dev:web   # see package.json
#
# Caveats:
#   - While this runs, the deployed beta bot is disconnected from Discord
#     (one gateway connection per token). It reconnects after Ctrl+C.
#   - The BETA Discord app must list http://localhost:5180/api/auth/discord/callback
#     in its OAuth redirect URIs, otherwise the token exchange 400s.

set -euo pipefail

# Resolve to the scout-for-lol package root regardless of caller cwd.
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
SCOUT_ROOT="$( cd "${SCRIPT_DIR}/.." && pwd )"
BACKEND_DIR="${SCOUT_ROOT}/packages/backend"
APP_DIR="${SCOUT_ROOT}/packages/app"

# Refuse to run without secrets resolved — caller forgot `op run --env-file=...`.
for required in DISCORD_TOKEN DISCORD_CLIENT_SECRET JWT_SIGNING_SECRET RIOT_API_KEY; do
  if [[ -z "${!required:-}" || "${!required:0:5}" == "op://" ]]; then
    echo "❌ ${required} not resolved. Run via:" >&2
    echo "   op run --env-file=${SCOUT_ROOT}/dev-web.env.tpl -- ${BASH_SOURCE[0]}" >&2
    exit 1
  fi
done

echo "▶️  Applying Prisma migrations against ${DATABASE_URL}"
( cd "${BACKEND_DIR}" && bunx prisma migrate deploy )

# Track child PIDs so Ctrl+C tears both down cleanly.
backend_pid=""
vite_pid=""

# Send TERM only when the process is still alive — kill of a dead PID
# would print "No such process" and (with errexit) abort the script.
# ps -p exits non-zero when PID is gone; its stdout is irrelevant here.
maybe_kill() {
  local pid="$1"
  if [[ -n "${pid}" ]] && ps -p "${pid}" > /dev/null; then
    kill -TERM "${pid}"
  fi
}

cleanup() {
  # Disable errexit for the duration of teardown so a wait/kill race
  # with an already-exited child can't crash the trap handler.
  set +e
  echo
  echo "🛑 Shutting down dev processes"
  maybe_kill "${backend_pid}"
  maybe_kill "${vite_pid}"
  wait
}
trap cleanup EXIT INT TERM

echo "▶️  Starting backend (${BACKEND_DIR})"
( cd "${BACKEND_DIR}" && bun --watch src/index.ts ) &
backend_pid=$!

echo "▶️  Starting Vite (${APP_DIR})"
( cd "${APP_DIR}" && bun run dev ) &
vite_pid=$!

cat <<EOF

────────────────────────────────────────────────────────────
✅ Scout local dev is up
   SPA:     http://localhost:5180/app/
   Backend: http://localhost:3000/trpc/

   Reload the SPA after a few seconds — the backend takes
   ~5s to log into Discord, validate champion assets, and
   open its HTTP listener.

   Ctrl+C to stop both processes.
────────────────────────────────────────────────────────────

EOF

# Wait on either child; if one dies, the trap kills the other.
wait -n "${backend_pid}" "${vite_pid}"
exit $?
