"""Browse verified reference encodings and navigate a model-specific Zh PCA plane."""
from __future__ import annotations
import copy
import os
from pathlib import Path
import time

import numpy as np
import torch
from rdkit import Chem

HERE = Path(__file__).resolve().parent


class LatentSpace:
    def __init__(self):
        self.bundles = {}

    def bundle(self, key):
        if key not in ('molalign3d', 'molflae'):
            raise ValueError('Unknown model')
        if key not in self.bundles:
            root = Path(os.environ.get('LATENT_ATLAS_DIR', str(HERE/'runtime'/'atlas')))
            path = root/(key+'.pt')
            if not path.is_file():
                raise ValueError('The latent map is being prepared. Please try again shortly.')
            bundle = torch.load(path, map_location='cpu', weights_only=False)
            from common.configuration import checkpoint_metadata
            expected = checkpoint_metadata(key)['files']['model.ckpt']['sha256']
            if bundle['catalog']['source']['checkpoint_sha256'] != expected:
                raise RuntimeError('Latent map checkpoint differs from the current model')
            bundle['lookup'] = {p['id']: i for i,p in enumerate(bundle['catalog']['points'])}
            self.bundles[key] = bundle
        return self.bundles[key]

    def project(self, key, zh):
        bundle = self.bundle(key)
        raw = zh.detach().cpu().numpy().reshape(-1).astype(np.float64)
        return ((raw-bundle['mean']) @ bundle['components'].T / bundle['sigma']).tolist()

    def point(self, key, point_id):
        bundle = self.bundle(key)
        index = bundle['lookup'].get(point_id)
        if index is None:
            raise ValueError('This molecule is not in the selected model map')
        return bundle['points'][index], bundle['catalog']['points'][index]

    def select(self, key, point_id, module):
        encoded, point = self.point(key, point_id)
        return {'model': key, 'model_name': module.MODEL_INFO[key]['name'], 'encoding_id': None,
                'input': copy.deepcopy(encoded['input']), 'latent': module.Engine.latent_payload(encoded),
                'encode_seconds': 0.0, 'seed': 42, 'kind': 'latent-selection',
                'atlas': {'version': self.bundle(key)['catalog']['version'], 'point': point,
                          'source': 'Precomputed singleton encoding from the verified model checkpoint'}}

    def locate(self, key, result, encoded):
        position = self.project(key, encoded['zh'])
        result['atlas'] = {'version': self.bundle(key)['catalog']['version'],
                           'point': {'id': result['encoding_id'], 'name': 'Your molecule',
                                     'position': position, 'smiles': result['input']['smiles'],
                                     'atom_count': result['input']['atom_count']}}
        result['kind'] = 'latent-location'
        return result

    def navigate(self, key, engine, point_id=None, encoding_id=None, map_version='',
                 delta_x=0.0, delta_y=0.0, frames=5, steps=100, seed=42, progress=lambda *args:None):
        started = time.monotonic()
        bundle = self.bundle(key)
        if map_version != bundle['catalog']['version']:
            raise ValueError('This map has changed. Reload it before navigating.')
        if (point_id is None) == (encoding_id is None):
            raise ValueError('Select one reference molecule or encode your own input')
        if not np.isfinite([delta_x,delta_y]).all() or np.hypot(delta_x,delta_y)>3.000001:
            raise ValueError('Choose a direction of at most 3 standard deviations')
        if point_id:
            source, point = self.point(key, point_id)
            source = dict(source)
        else:
            source = engine.encodings.get(encoding_id)
            if source is None or time.time()-source['created']>3600:
                raise ValueError('This input encoding expired. Encode it again.')
            source = dict(source)
            point = {'id': encoding_id, 'name': 'Your molecule', 'position': self.project(key, source['zh'])}
            from importlib import import_module
            source['input'] = import_module(key+'.engine').molecule_payload(source['mol'])
        engine.load(key)
        source['key'] = key
        start = np.asarray(self.project(key, source['zh']))
        delta = np.asarray([delta_x,delta_y])
        step = (delta*bundle['sigma']) @ bundle['components']
        increment = torch.tensor(step.reshape(source['zh'].shape),dtype=source['zh'].dtype)
        results=[]
        for i, alpha in enumerate(np.linspace(0,1,frames)):
            progress(f'Decoding directed latent step {i+1} / {frames}',.1+.85*i/frames)
            mixed = dict(source)
            mixed['zh'] = source['zh']+float(alpha)*increment
            # At the source preserve the exact original conditioning. Else use
            # the checkpoint's structural normalization with fixed semantics.
            mixed['condition'] = source['condition'] if not alpha or not np.any(delta) else engine._replace_structural(source,mixed['zh'])
            decoded, generated = engine._decode(mixed,steps,seed,source['mol'].GetNumAtoms())
            requested = (start+alpha*delta).tolist()
            projected_output = None
            if decoded['rdkit_valid'] and decoded['fragments']==1:
                try:
                    mol = Chem.RemoveHs(Chem.Mol(generated))
                    coords = np.asarray(mol.GetConformer().GetPositions(),dtype=np.float32)
                    coords -= coords.mean(0,keepdims=True)
                    output_encoding = engine._encode(key,mol,coords)
                    projected_output = self.project(key,output_encoding['zh'])
                except (ValueError, RuntimeError):
                    pass
            results.append({'alpha':float(alpha), 'label':f'{float(alpha)*np.linalg.norm(delta):.2f} σ',
                            'latent':engine.latent_payload(mixed), 'decoded':decoded,
                            'map_position':self.project(key,mixed['zh']),
                            'requested_map_position':requested, 'decoded_map_position':projected_output})
        distances = [float(np.linalg.norm(np.asarray(p['position'])-(start+delta))) for p in bundle['catalog']['points']]
        nearest = sorted(range(len(distances)),key=distances.__getitem__)[:5]
        return {'model':key, 'model_name':{'molalign3d':'MolAlign3D','molflae':'MolFLAE'}[key], 'input':source['input'],
                'frames':results, 'kind':'latent-navigation','steps':steps,'seed':seed,
                'runtime_seconds':time.monotonic()-started,
                'sampling':'Straight line in the two displayed Zh principal components; source residual, Zx, atom count and UniMol semantic blocks fixed; same decoder seed across frames.',
                'navigation':{'version':map_version,'source':point,'start':start.tolist(),
                              'target':(start+delta).tolist(),'delta':delta.tolist(),
                              'distance_sigma':float(np.linalg.norm(delta)),
                              'angle_degrees':float(np.degrees(np.arctan2(delta_y,delta_x))%360),
                              'raw_zh_distance':float(np.linalg.norm(step)),
                              'nearest_in_projection':[{**bundle['catalog']['points'][j], 'map_distance':distances[j]} for j in nearest],
                              'note':'Nearby points share a 2D projection, not necessarily the same full latent. Decoding and re-encoding need not return to the requested point.'}}
