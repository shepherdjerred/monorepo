"""Prepare RGBA8 pixels for the additional complete effect-root materials."""
import json
from pathlib import Path
import sys
from PIL import Image
from vfx_spawn_native import sha

cache = Path(sys.argv[1]).resolve()
assets = cache/'public'
target = assets/'latest-effect-root-textures'
target.mkdir(exist_ok=True)
names = ['latest-effect-root-frame-caches/package.json',
         'latest-complete-quad-gpu/package.json', 'latest-trail-particles/gpu.json',
         'latest-quad-erosion-gpu/package.json']
packages = {name: (assets/name).read_bytes() for name in names}
roots = {v['effectId'] for v in json.loads(packages[names[0]])['caches']}
textures = {}
for name in names[1:]:
    for emitter in json.loads(packages[name])['emitters']:
        if emitter['effectId'] not in roots:
            continue
        for binding in emitter['textures'].values():
            if binding['kind'] != 'prepared-texture':
                if binding['kind'] not in ['supplied-white-lookup', 'supplied-transparent-remap']:
                    raise ValueError('Unknown effect-root texture binding')
                continue
            key = binding['sha256']
            if key in textures:
                if textures[key]['sourceFile'] != binding['file']:
                    raise ValueError('Ambiguous effect-root texture')
                continue
            source = assets/'latest-effects'/binding['file']
            if sha(source.read_bytes()) != key:
                raise ValueError('Effect-root source texture changed')
            with Image.open(source) as image:
                image.load()
                rgba = image.convert('RGBA')
                width, height = rgba.size
                pixels = rgba.tobytes()
            digest = sha(pixels)
            filename = 'rgba-'+digest+'.bin'
            (target/filename).write_bytes(pixels)
            textures[key] = {'sourceFile': binding['file'], 'sourceSha256': key,
                'file': filename, 'sha256': digest, 'bytes': len(pixels),
                'width': width, 'height': height}
result = {'schema': 1, 'kind': 'prepared-effect-root-rgba8-textures',
    'build': '16.21.829.8620', 'protocol': '20e09df23c66b85e',
    'packages': {name: sha(value) for name, value in packages.items()},
    'preparerSha256': sha(Path(__file__).read_bytes()), 'effects': sorted(roots),
    'textures': textures, 'scope': {'containsReplayData': False, 'pixelFormat': 'RGBA8',
        'rowOrder': 'source-top-to-bottom', 'premultiplied': False,
        'colorSpaceConversion': False, 'mipmaps': False}}
encoded = json.dumps(result, indent=2).encode()
(target/'package.json').write_bytes(encoded)
print(json.dumps({'sha256': sha(encoded), 'textures': len(textures),
                  'bytes': sum(t['bytes'] for t in textures.values())}))
