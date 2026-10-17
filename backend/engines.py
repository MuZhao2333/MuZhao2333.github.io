"""Route the website's serialized worker to the two released model packages.

This module owns no neural architecture or sampling code. Each operation calls
the same package Engine used by the research CLI, with independently cached
models and encodings. Use one worker: both engines set process-wide RNG seeds.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path

import torch

from molalign3d import engine as molalign3d_engine
from molflae import engine as molflae_engine
from molresearch.configuration import checkpoint_metadata

CODE_REVISION = os.environ.get("MODEL_CODE_REVISION", "unrecorded")
BACKEND_REVISION = os.environ.get("BACKEND_CODE_REVISION", "unrecorded")
PACKAGES = {"molalign3d": molalign3d_engine, "molflae": molflae_engine}
CHECKPOINTS = {key: checkpoint_metadata(key) for key in PACKAGES}
MODEL_INFO = {}
for key, package in PACKAGES.items():
    info = dict(package.MODEL_INFO[key])
    record = CHECKPOINTS[key]
    for field, expected in record["architecture"].items():
        if info[field] != expected:
            raise RuntimeError(f"{key}: package architecture differs from checkpoint manifest")
    info.update(
        checkpoint=record["original_checkpoint"],
        checkpoint_asset=package.MODEL_INFO[key]["checkpoint"],
        checkpoint_sha256=record["files"]["model.ckpt"]["sha256"],
        code_repository="MolAlign3D",
        code_revision=CODE_REVISION,
        inference_module=package.__name__,
        backend_code_revision=BACKEND_REVISION,
    )
    MODEL_INFO[key] = info
    logging.getLogger(__name__).info("%s inference source: %s", key, package.__file__)


class Engine:
    """API-compatible facade; load each model only when first requested."""

    def __init__(self):
        for key, package in PACKAGES.items():
            logging.getLogger(__name__).info("%s inference source: %s", key, package.__file__)
        requested = os.environ.get("MOLRESEARCH_DEVICE", "auto")
        self.device = torch.device("cpu" if requested == "cpu" or not torch.cuda.is_available() else "cuda:0")
        self._engines = {}
        self.verified = set()

    @property
    def models(self):
        return {key: model for engine in self._engines.values() for key, model in engine.models.items()}

    def _get_engine(self, key):
        if key not in PACKAGES:
            raise ValueError("Unknown model.")
        if key not in self.verified:
            for filename, record in CHECKPOINTS[key]["files"].items():
                path = PACKAGES[key].ROOT / filename
                with path.open("rb") as source:
                    digest = hashlib.file_digest(source, "sha256").hexdigest()
                if digest != record["sha256"]:
                    raise RuntimeError(f"{key}: checkpoint asset checksum mismatch: {filename}")
            self.verified.add(key)
        if key not in self._engines:
            self._engines[key] = PACKAGES[key].Engine()
        return self._engines[key]

    def _stamp(self, result, key):
        result["provenance"] = {
            **result.get("provenance", {}),
            **{field: value for field, value in MODEL_INFO[key].items() if field not in ("name", "config")},
            "weights_verified": key in self.verified,
        }
        return result

    def _run(self, operation, key, **args):
        engine = self._get_engine(key)
        return self._stamp(getattr(engine, operation)(key=key, **args), key)

    def encode(self, key, **args):
        return self._run("encode", key, **args)

    def reconstruct(self, key, **args):
        return self._run("reconstruct", key, **args)

    def decode(self, encoding_id, **args):
        # Decode requests intentionally carry only an opaque encoding ID. Look
        # up its owner rather than using whichever model the UI last selected.
        for key, engine in self._engines.items():
            if encoding_id in engine.encodings:
                return self._stamp(engine.decode(encoding_id=encoding_id, **args), key)
        raise ValueError("This encoding expired. Please encode the molecule again.")

    def wander(self, key, **args):
        return self._run("wander", key, **args)

    def atom_edit(self, key, **args):
        return self._run("atom_edit", key, **args)

    def interpolate(self, key, **args):
        return self._run("interpolate", key, **args)

    def swap(self, key, **args):
        return self._run("swap", key, **args)
