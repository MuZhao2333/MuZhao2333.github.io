# Molecular laboratory backend

This homepage repository owns the HTTP API, request queue, model routing and
deployment scripts. Neural architectures, training, model configuration and
checkpoints live in the separate MolAlign3D research checkout.

The backend imports `molalign3d.engine.Engine` and `molflae.engine.Engine` from
the installed research package. It adds a serialized inference queue, bounded
encoding/job caches, checkpoint hash verification and CORS for the homepage.
Both models load on first use. Defaults are CPU, four threads and 100 decoder
steps. No model source or checkpoint is copied into this public repository.

## Start on a server

Keep the two checkouts next to each other, install the model environment, then
install `backend/requirements.txt` with the Python interpreter used to serve it.

```text
parent/
  MolAlign3D/                 Model source, .venv and private checkpoint assets
  MuZhao2333.github.io/
    backend/
    models/
    index.html
```

```bash
cd MuZhao2333.github.io
../MolAlign3D/.venv/bin/python -m pip install -r backend/requirements.txt
bash backend/start.sh
bash backend/stop.sh
```

Set `MODEL_ROOT` for a different model checkout and `BACKEND_PYTHON` for
its installed interpreter. `BACKEND_HOST`, `BACKEND_PORT`, `BACKEND_RUNTIME`,
`MOLECULAR_DEVICE`, `MOLECULAR_CPU_THREADS` and `DEMO_ALLOWED_ORIGINS` control
deployment. Logs and the server PID stay in ignored `backend/runtime/`.

The default loopback address is port 7868, behind an independently managed
HTTPS gateway. GitHub Pages serves the public static pages and cannot execute
Python. `models/config.js` points those pages to the public gateway. Restarting
this API on the same port does not require changing the frontend URL.

## Check a deployment

```bash
python backend/verify_api.py --base-url http://127.0.0.1:7868 \
  --output backend/runtime/verification.json
```

The verifier exercises both actual models: interleaved encode/cache decode,
reconstruction, local walk, atom-count editing, interpolation and Zx/Zh swaps.
It checks 100-step defaults, latent dimensions and actual predicted coordinates.
API metadata records the model commit; inference provenance also records the
homepage backend commit. All requests must use one worker because jobs, model
caches and random seeds are process-local.

For a candidate on another port, set `BACKEND_PORT=7869` and a separate
`BACKEND_RUNTIME` before invoking `start.sh`. The optional static preview serves
the public homepage files; backend runtime files are excluded from that surface.
