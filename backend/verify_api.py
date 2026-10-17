"""Check both real models via the website's queued API (stdlib only)."""
from __future__ import annotations

import argparse
import json
import math
import time
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    def request(path, payload=None):
        body = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(base + path, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=45) as response:
            return json.load(response)

    checks = []

    def run(operation, payload, model):
        started = time.monotonic()
        token = request("/api/" + operation, payload)["job_id"]
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            job = request("/api/jobs/" + token)
            if job["status"] == "error":
                raise AssertionError(f"{model}/{operation}: {job['message']}")
            if job["status"] == "complete":
                result = job["result"]
                break
            time.sleep(0.4)
        else:
            raise TimeoutError(f"{model}/{operation}")
        assert result["model"] == model
        provenance = result["provenance"]
        assert provenance["inference_module"] == model + ".engine"
        assert provenance["code_repository"] == "MolAlign3D"
        assert provenance["weights_verified"] is True
        assert provenance["code_revision"] != "unrecorded"
        dims = {"molalign3d": [8, 16], "molflae": [10, 32]}[model]
        decoder = [8, 80] if model == "molalign3d" else [10, 32]
        frames = result.get("frames", [])
        latents = ([result["latent"]] if "latent" in result else []) + [frame["latent"] for frame in frames]
        for latent in latents:
            assert latent["feature_shape"] == dims
            assert latent["position_shape"] == [dims[0], 3]
            assert latent["decoder_shape"] == decoder
            assert all(math.isfinite(v) for field in ("positions", "features", "decoder_features") for row in latent[field] for v in row)
        outputs = ([result["decoded"]] if "decoded" in result else []) + [frame["decoded"] for frame in frames]
        for output in outputs:
            assert output["steps"] == 100
            assert len(output["coordinates"]) == output["predicted_atom_count"]
            assert all(math.isfinite(v) for point in output["coordinates"] for v in point)
            assert output["molblock"].strip()
        checks.append({"model": model, "operation": operation, "passed": True,
                       "seconds": round(time.monotonic() - started, 3), "provenance": provenance,
                       "decoded_frames": len(outputs), "default_steps": 100 if outputs else None})
        print(f"{model}/{operation}: passed ({checks[-1]['seconds']}s)", flush=True)
        return result

    aspirin = "CC(=O)Oc1ccccc1C(=O)O"
    second = "CC(=O)Nc1ccc(O)cc1"
    saved = {}
    # Interleave the model selection; decode requests contain no model key.
    for model in ("molalign3d", "molflae"):
        saved[model] = run("encode", {"model": model, "smiles": aspirin}, model)
    for model in ("molalign3d", "molflae"):
        decoded = run("decode", {"encoding_id": saved[model]["encoding_id"]}, model)
        reconstructed = run("reconstruct", {"model": model, "smiles": aspirin}, model)
        assert decoded["decoded"]["coordinates"] == reconstructed["decoded"]["coordinates"]
        assert saved[model]["latent"] == reconstructed["latent"]
        common = {"model": model, "smiles": aspirin}
        walk = run("wander", {**common, "frames": 2}, model)
        assert walk["frames"][0]["latent"] == saved[model]["latent"]
        assert walk["frames"][1]["latent"]["positions"] != walk["frames"][0]["latent"]["positions"]
        assert walk["frames"][1]["latent"]["features"] != walk["frames"][0]["latent"]["features"]
        edit = run("atom-edit", {**common, "radius": 1}, model)
        count = saved[model]["input"]["atom_count"]
        assert [frame["decoded"]["predicted_atom_count"] for frame in edit["frames"]] == [count - 1, count, count + 1]
        assert all(frame["latent"] == saved[model]["latent"] for frame in edit["frames"])
        pair = {"model": model, "a": {"smiles": aspirin}, "b": {"smiles": second}}
        interpolation = run("interpolate", {**pair, "frames": 3}, model)
        assert [frame["alpha"] for frame in interpolation["frames"]] == [0, 0.5, 1]
        swap = run("swap", pair, model)
        assert [(frame["geometry_source"], frame["feature_source"]) for frame in swap["frames"]] == [("A", "A"), ("B", "A"), ("A", "B"), ("B", "B")]
        frames = swap["frames"]
        assert frames[0]["latent"]["positions"] == frames[2]["latent"]["positions"]
        assert frames[1]["latent"]["positions"] == frames[3]["latent"]["positions"]
        assert frames[0]["latent"]["decoder_features"] == frames[1]["latent"]["decoder_features"]
        assert frames[2]["latent"]["decoder_features"] == frames[3]["latent"]["decoder_features"]
    report = {"passed": True, "base_url": base, "models": request("/api/models"), "checks": checks}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
