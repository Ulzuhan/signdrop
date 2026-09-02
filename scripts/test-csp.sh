#!/usr/bin/env bash
#
# Levanta SignDrop con un secreto de usar y tirar y corre test-csp.mjs
# contra él.
#
# Sin proveedor de identidad: esta suite forja las cookies con el mismo
# secreto que el servidor, que es justo lo que solo debe poder hacer quien lo
# tenga. El viaje de ida y vuelta al proveedor lo prueba test-backchannel.sh,
# que sí levanta uno.
#
#   npm run test:acceso     # hace falta un build antes (npm run build)
set -uo pipefail
set -m

cd "$(dirname "$0")/.."

PORT="${PORT:-4013}"
export BASE="http://127.0.0.1:$PORT"
export SIGNDROP_SESSION_SECRET="secreto-de-pruebas-con-treinta-y-dos-bytes"
WORK="$(mktemp -d)"
LOG="$WORK/server.log"

server_pid=""

stop() {
  [ -n "$server_pid" ] || return 0
  # El grupo entero: el standalone deja un trabajador que se queda el puerto.
  kill -- -"$server_pid" 2>/dev/null || kill "$server_pid" 2>/dev/null
  wait "$server_pid" 2>/dev/null
  server_pid=""
}

cleanup() {
  stop
  rm -rf "$WORK"
}
trap 'cleanup; exit 130' INT TERM

SIGNDROP_PUBLIC_HOST="127.0.0.1:$PORT" \
  HOSTNAME=127.0.0.1 PORT="$PORT" \
  node scripts/start.js >"$LOG" 2>&1 &
server_pid=$!

for _ in $(seq 1 90); do
  curl -sf -o /dev/null "$BASE/" && break
  sleep 0.5
done

if ! curl -sf -o /dev/null "$BASE/"; then
  echo "el servidor no arrancó:"
  tail -20 "$LOG"
  cleanup
  exit 1
fi

node scripts/test-csp.mjs
estado=$?

[ "$estado" -eq 0 ] || tail -30 "$LOG"

cleanup
exit "$estado"
