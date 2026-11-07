"""Prepare RGBA8 for every existing native component material, without replay data."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    assets = args.cache.resolve() / 'public'
    target = assets / 'latest-component-textures'
    target.mkdir(exist_ok=True)
    sha = lambda data: hashlib.sha256(data).hexdigest()
    manifest_bytes = (assets / 'latest-effects/manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest['build'] != '16.21.829.8620' or manifest['protocol'] != '20e09df23c66b85e':
        raise ValueError('Exact component texture build required')
    packages, textures = {}, {}
    for name in ['latest-complete-quad-gpu/package.json', 'latest-trail-particles/gpu.json',
                 'latest-quad-erosion-gpu/package.json']:
        encoded = (assets / name).read_bytes()
        package = json.loads(encoded)
        if (package['build'] != manifest['build'] or package['protocol'] != manifest['protocol'] or
                package['effectsManifestSha256'] != sha(manifest_bytes) or
                package['counts']['emitters'] != len(package['emitters'])):
            raise ValueError('Component material build differs')
        packages[name] = sha(encoded)
        for emitter in package['emitters']:
            definition = manifest['definitions'].get(emitter['effectId'])
            if definition is None or definition['sha256'] != emitter['sourceDefinitionSha256']:
                raise ValueError('Component material source definition differs')
            for binding in emitter['textures'].values():
                if binding['kind'] != 'prepared-texture':
                    if binding['kind'] not in ['supplied-white-lookup', 'supplied-transparent-remap']:
                        raise ValueError('Unknown component texture kind')
                    continue
                key = binding['sha256']
                if key in textures:
                    if textures[key]['sourceFile'] != binding['file']:
                        raise ValueError('Ambiguous component PNG identity')
                    continue
                source = (assets / 'latest-effects' / binding['file']).resolve()
                if not source.is_relative_to((assets / 'latest-effects').resolve()) or sha(source.read_bytes()) != key:
                    raise ValueError('Component PNG path/hash differs')
                with Image.open(source) as image:
                    image.load()
                    width, height = image.size
                    if not 1 <= width <= 16384 or not 1 <= height <= 16384 or width * height > 16777216:
                        raise ValueError('Component texture exceeds the bounded pixel contract')
                    data = image.convert('RGBA').tobytes()
                digest = sha(data)
                filename = f'rgba-{digest}.bin'
                (target / filename).write_bytes(data)
                textures[key] = {'sourceFile': binding['file'], 'sourceSha256': key,
                                 'file': filename, 'sha256': digest, 'bytes': len(data),
                                 'width': width, 'height': height}
    result = {'schema': 1, 'kind': 'prepared-component-rgba8-textures',
              'build': manifest['build'], 'protocol': manifest['protocol'],
              'effectsManifestSha256': sha(manifest_bytes), 'packages': packages,
              'preparerSha256': sha(Path(__file__).read_bytes()), 'textures': textures,
              'scope': {'containsReplayData': False, 'selection': 'all-prepared-native-component-materials',
                        'pixelFormat': 'RGBA8', 'rowOrder': 'source-top-to-bottom',
                        'premultiplied': False, 'colorSpaceConversion': False, 'mipmaps': False}}
    data = (json.dumps(result, indent=2) + '\n').encode()
    (target / 'package.json').write_bytes(data)
    print(json.dumps({'sha256': sha(data), 'textures': len(textures),
                      'rgbaBytes': sum(t['bytes'] for t in textures.values())}))


if __name__ == '__main__':
    main()
