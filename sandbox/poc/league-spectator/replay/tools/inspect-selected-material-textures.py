"""Independent Pillow comparison of selected raw RGBA channel bytes; no rendering."""
import argparse
import hashlib
import io
import json
from pathlib import Path
from PIL import Image, __version__ as pillow_version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    inputs = {}

    def raw(path):
        path = path.resolve()
        value = path.read_bytes()
        digest = hashlib.sha256(value).hexdigest()
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Texture input changed')
        inputs[str(path)] = digest
        return value

    base = cache/'public/latest-selected-material-textures'
    package_bytes = raw(base/'package.json')
    package = json.loads(package_bytes)
    if package['pngPolicy'] != 'strict-static-rgba8-png-channel-bytes-v1':
        raise ValueError('Unexpected selected PNG policy')
    count = size = 0
    for key, entry in package['textures'].items():
        png = raw(cache/'public/latest-effects'/entry['sourceFile'])
        data = raw(base/entry['file'])
        if hashlib.sha256(png).hexdigest() != key or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError('Selected pixel source hash differs')
        with Image.open(io.BytesIO(png)) as image:
            image.load()
            if image.mode != 'RGBA' or image.size != (entry['width'], entry['height']):
                raise ValueError('Selected source is not the existing RGBA PNG format')
            if image.tobytes() != data:
                raise ValueError('Independent decoded PNG/raw RGBA mismatch')
        if len(data) != entry['width'] * entry['height'] * 4 or len(data) != entry['bytes']:
            raise ValueError('Selected pixel byte count differs')
        count += 1
        size += len(data)
    raw(Path(__file__))
    for filename in ['prepare-selected-material-textures.mjs', '../latest-rgba8-png.mjs']:
        raw(Path(__file__).parent/filename)
    for path, digest in inputs.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
            raise ValueError('Selected pixel evidence input changed')
    report = {'schema': 1, 'kind': 'selected-material-rgba8-independent-comparison',
              'inputs': inputs, 'packageSha256': hashlib.sha256(package_bytes).hexdigest(),
              'pillowVersion': pillow_version, 'textures': count, 'rgbaBytes': size,
              'mismatches': 0, 'scope': {'pngDecodedIndependently': True, 'rawChannelBytesCompared': True,
                                        'colorSpaceConversion': False, 'premultiplied': False,
                                        'nativeMaterialAdmissionEstablished': False, 'renderingEstablished': False}}
    (cache/'research/selected-material-textures-comparison.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'textures': count, 'rgbaBytes': size, 'mismatches': 0}))


if __name__ == '__main__':
    main()
