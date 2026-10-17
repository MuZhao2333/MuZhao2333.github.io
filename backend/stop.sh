#!/usr/bin/env bash
set -euo pipefail
backend_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
backend_runtime="${BACKEND_RUNTIME:-$backend_dir/runtime}"
if [[ ! -f "$backend_runtime/server.pid" ]]; then echo "No backend PID file."; exit 0; fi
backend_pid="$(cat "$backend_runtime/server.pid")"
if kill -0 "$backend_pid" 2>/dev/null && [[ -r "/proc/$backend_pid/cmdline" ]] && tr '\0' ' ' < "/proc/$backend_pid/cmdline" | grep -Fq -- "$backend_dir"; then
  kill "$backend_pid"
  echo "Stopped homepage backend (PID $backend_pid)."
else
  echo "PID is stale or belongs to another process."
fi
rm -f -- "$backend_runtime/server.pid"
