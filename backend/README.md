# Molecular laboratory backend

This homepage repository owns the HTTP API, request queue, model routing and
deployment scripts. Neural architectures, training, model configuration and
checkpoints live in the separate MolAlign3D research checkout.

The backend imports `molalign3d.engine.Engine` and `molflae.engine.Engine` from
the installed research package. It adds a serialized inference queue, bounded
encoding/job caches, checkpoint hash verification and CORS for the homepage.
Both models load on first use. Defaults are CUDA GPU 0, four CPU threads and 100 decoder
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
`BACKEND_CUDA_VISIBLE_DEVICES`, `MOLECULAR_DEVICE`, `MOLECULAR_CPU_THREADS` and `DEMO_ALLOWED_ORIGINS` control
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

## Latent-space explorer

The explorer uses two independent PCA maps of flattened raw structural Zh.
Each map contains 240 original ZINC experiment conformers and 16 named reference
molecules. Inputs are encoded one at a time, with seed 42, matching the demo's
UniMol conditioning normalization. Models, hashes, selection method, reference
count and explained variance are recorded in the public catalogue.

Build both maps with the installed model environment:

```bash
CUDA_VISIBLE_DEVICES=0 ../MolAlign3D/.venv/bin/python backend/build_latent_space.py \
  --inputs /path/to/original/latent_ex_data/fixed \
  --private-output backend/runtime/atlas --public-output models/latent-space
```

The public JSON files contain only projection coordinates and molecular metadata.
Original conformers, full-precision encodings, PCA components and normalization
values remain in the ignored `backend/runtime/atlas` files, which must be copied
when deploying to another server. The API checks the atlas checkpoint identity
and rejects navigation requests with stale map versions. Static serving excludes
backend files. No atlas files or HTTP APIs are added to the model repository.

`latent-select` inspects a saved encoding. `latent-locate` encodes a custom input
and projects it into the current model's map. `latent-navigate` moves raw Zh by
`dx * sigma_PC1 * component_1 + dy * sigma_PC2 * component_2` from the selected
source, preserving its residual outside this plane. Axis distances are in
standard deviations; paths are capped at 3 sigma and 11 frames. Zx, atom count
and UniMol semantic channels remain fixed. Each frame uses the same decoder
seed. Valid connected outputs are also re-encoded and plotted separately;
proximity in the 2D projection does not establish proximity in the full latent.
This exploratory PCA plane is not a trained generative prior.

`start.sh` now selects GPU 0 and requires CUDA by default. Models still load on
first use. Set `MOLECULAR_DEVICE=cpu BACKEND_CUDA_VISIBLE_DEVICES=-1` explicitly
for CPU deployment. Float32 CUDA scatter reductions can vary by a few rounding
units between repeated encodes; the verifier checks numeric agreement with
absolute tolerance 2e-4 rather than exact float equality.
