"""Build checkpoint-specific PCA maps from original 3D ZINC inputs.

Run with the model environment. Public catalogues contain point metadata;
full-precision encodings and conformers remain in ignored backend/runtime/atlas.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess

import numpy as np
import torch
from rdkit import RDLogger
from rdkit.Chem import Crippen, QED, rdMolDescriptors
from sklearn.decomposition import PCA

from common.configuration import checkpoint_metadata

ANCHORS = [
    ("Caffeine", "Cn1c(=O)c2c(ncn2C)n(C)c1=O"),
    ("Aspirin", "CC(=O)Oc1ccccc1C(=O)O"),
    ("Phenacetin", "CCOc1ccc(NC(C)=O)cc1"),
    ("Acetaminophen", "CC(=O)Nc1ccc(O)cc1"),
    ("Ibuprofen", "CC(C)Cc1ccc(C(C)C(=O)O)cc1"),
    ("Naproxen (unspecified stereochemistry)", "COc1ccc2cc(C(C)C(=O)O)ccc2c1"),
    ("Benzoic acid", "O=C(O)c1ccccc1"),
    ("Salicylic acid", "O=C(O)c1ccccc1O"),
    ("Benzamide", "NC(=O)c1ccccc1"),
    ("Aniline", "Nc1ccccc1"),
    ("Nicotinamide", "NC(=O)c1cccnc1"),
    ("Lidocaine", "CCN(CC)CC(=O)Nc1c(C)cccc1C"),
    ("Dopamine", "NCCc1ccc(O)c(O)c1"),
    ("Benzene", "c1ccccc1"),
    ("Pyridine", "c1ccncc1"),
    ("Acetophenone", "CC(=O)c1ccccc1"),
]

def build(args):
    RDLogger.DisableLog('rdApp.warning')
    source = Path(args.inputs).resolve()
    files = sorted(source.glob('*.sdf'))
    if len(files) < args.zinc_count:
        raise ValueError('Not enough original SDF inputs')
    chosen = [files[i] for i in np.linspace(0, len(files)-1, args.zinc_count, dtype=int)]
    os.environ['MOLECULAR_DEVICE'] = args.device
    os.environ['MOLECULAR_CPU_THREADS'] = '4'
    private = Path(args.private_output); private.mkdir(parents=True, exist_ok=True)
    public = Path(args.public_output); public.mkdir(parents=True, exist_ok=True)
    for key in ('molalign3d', 'molflae'):
        torch.manual_seed(42); np.random.seed(42)
        module = importlib.import_module(key + '.engine')
        engine = module.Engine()
        if args.device == 'auto' and engine.device.type != 'cuda':
            raise RuntimeError('CUDA was requested for map generation but is unavailable')
        rows, encodings, provenance = [], [], []
        specs = [('anchor-'+str(i), name, {'smiles': smiles}, None) for i, (name, smiles) in enumerate(ANCHORS)]
        specs += [('zinc-'+p.stem, 'ZINC · '+p.stem, {'molblock': p.read_text()}, p) for p in chosen]
        for identity, name, spec, path in specs:
            mol, coords, description = module.prepare_molecule(seed=42, **spec)
            encoded = engine._encode(key, mol, coords)
            payload = module.molecule_payload(mol, description)
            rows.append({'id': identity, 'name': name, 'smiles': payload['smiles'],
                         'formula': rdMolDescriptors.CalcMolFormula(mol), 'atom_count': mol.GetNumAtoms(),
                         'qed': float(QED.qed(mol)), 'logp': float(Crippen.MolLogP(mol)),
                         'source': 'named reference' if path is None else 'original ZINC experiment input'})
            encodings.append({**encoded, 'input': payload})
            provenance.append({'id': identity, 'input_sha256': hashlib.sha256(path.read_bytes()).hexdigest() if path else None})
            if len(rows) % 64 == 0: print(key, len(rows), 'encoded on', engine.device, flush=True)
        matrix = np.stack([e['zh'].numpy().reshape(-1) for e in encodings]).astype(np.float64)
        pca = PCA(n_components=2, svd_solver='full').fit(matrix)
        sigma = np.sqrt(pca.explained_variance_)
        if np.any(sigma < 1e-8): raise ValueError('Degenerate PCA map')
        coordinates = pca.transform(matrix) / sigma
        checkpoint = checkpoint_metadata(key)['files']['model.ckpt']['sha256']
        if hashlib.sha256((module.ROOT/'model.ckpt').read_bytes()).hexdigest() != checkpoint:
            raise RuntimeError('Checkpoint checksum does not match the release manifest')
        identity_hash = hashlib.sha256(matrix.tobytes()+pca.components_.tobytes()+checkpoint.encode()).hexdigest()
        for row, point in zip(rows, coordinates): row['position'] = point.tolist()
        catalog = {'model': key, 'version': identity_hash[:16], 'points': rows, 'count': len(rows),
                   'projection': {'kind': 'PCA of flattened raw structural Zh', 'units': 'standard deviations along each principal component',
                                  'explained_variance_ratio': pca.explained_variance_ratio_.tolist(),
                                  'structural_shape': list(encodings[0]['zh'].shape),
                                  'note': 'A two-dimensional projection of structural features; geometry Zx and UniMol semantics are not represented on these axes.'},
                   'source': {'zinc_count': args.zinc_count, 'named_count': len(ANCHORS),
                              'selection': 'evenly spaced indices in lexicographically sorted original experiment SDF files',
                              'original_file_count': len(files), 'seed': 42,
                              'encoding_batch_size': 1, 'checkpoint_sha256': checkpoint,
                              'model_code_revision': subprocess.check_output(['git','-C',str(Path(module.__file__).parents[2]),'rev-parse','HEAD'],text=True).strip()},
                   'navigation': {'max_distance': 3.0, 'fixed': ['Zx', 'atom count', 'UniMol semantic blocks', 'structural residual outside the PCA plane']}}
        (public / (key+'.json')).write_text(json.dumps(catalog, separators=(',', ':'), allow_nan=False)+'\n')
        bundle = {'catalog': catalog, 'points': encodings, 'input_provenance': provenance,
                  'mean': pca.mean_, 'components': pca.components_, 'sigma': sigma}
        torch.save(bundle, private / (key+'.pt'))
        print(key, 'saved', len(rows), 'points; PC1+2 variance', float(pca.explained_variance_ratio_.sum()), flush=True)
        del engine
        torch.cuda.empty_cache()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', required=True)
    parser.add_argument('--private-output', required=True)
    parser.add_argument('--public-output', required=True)
    parser.add_argument('--zinc-count', type=int, default=240)
    parser.add_argument('--device', choices=['cpu','auto'], default='auto')
    build(parser.parse_args())
