#!/usr/bin/env bash
set -euo pipefail
backend_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$backend_dir"
model_dir="${MODEL_ROOT:-$(dirname "$(dirname "$backend_dir")")/MolAlign3D}"
backend_python="${BACKEND_PYTHON:-$model_dir/.venv/bin/python}"
backend_runtime="${BACKEND_RUNTIME:-$backend_dir/runtime}"
mkdir -p "$backend_runtime"
if [[ -f "$backend_runtime/server.pid" ]]; then
  backend_pid="$(cat "$backend_runtime/server.pid")"
  if kill -0 "$backend_pid" 2>/dev/null && [[ -r "/proc/$backend_pid/cmdline" ]] && tr '\0' ' ' < "/proc/$backend_pid/cmdline" | grep -Fq -- "$backend_dir"; then
    echo "Backend already running (PID $backend_pid)."
    exit 0
  fi
fi
model_revision="$(git -C "$model_dir" rev-parse HEAD)"
backend_revision="$(git -C "$backend_dir" rev-parse HEAD)"
if [[ -n "$(git -C "$model_dir" status --porcelain)" ]]; then
  echo "Commit model source changes before deployment to record its revision." >&2
  exit 1
fi
"$backend_python" - "$model_dir" "${MOLECULAR_DEVICE:-cuda}" "${BACKEND_CUDA_VISIBLE_DEVICES:-0}" <<'PY'
import pathlib
import sys
import os
os.environ["CUDA_VISIBLE_DEVICES"] = sys.argv[3]
import torch
if sys.argv[2] == "cuda" and not torch.cuda.is_available():
    raise RuntimeError("GPU serving is configured but the selected CUDA device is unavailable")
import fastapi
import uvicorn
from molalign3d import engine as molalign3d_engine
from molflae import engine as molflae_engine
source = pathlib.Path(sys.argv[1]).resolve() / "src"
for module in (molalign3d_engine, molflae_engine):
    if not pathlib.Path(module.__file__).resolve().is_relative_to(source):
        raise RuntimeError(f"Unexpected model source: {module.__file__}")
    print(f"Using {module.__name__}: {module.__file__}")
PY
nohup env CUDA_VISIBLE_DEVICES="${BACKEND_CUDA_VISIBLE_DEVICES:-0}" MOLECULAR_DEVICE="${MOLECULAR_DEVICE:-cuda}" MOLECULAR_CPU_THREADS="${MOLECULAR_CPU_THREADS:-4}" MODEL_CODE_REVISION="$model_revision" BACKEND_CODE_REVISION="$backend_revision" HOMEPAGE_ROOT="${HOMEPAGE_ROOT:-$(dirname "$backend_dir")}" DEMO_ALLOWED_ORIGINS="${DEMO_ALLOWED_ORIGINS:-https://muzhao2333.github.io}" \
  "$backend_python" -m uvicorn server:app --app-dir "$backend_dir" --host "${BACKEND_HOST:-127.0.0.1}" --port "${BACKEND_PORT:-7868}" --workers 1 \
  > "$backend_runtime/server.log" 2>&1 < /dev/null &
echo "$!" > "$backend_runtime/server.pid"
echo "Started homepage backend (PID $(cat "$backend_runtime/server.pid")), port ${BACKEND_PORT:-7868}."
