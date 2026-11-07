"""Visualize proven original CPU blue bytes, not a game/GPU visibility mask."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args(); cache = args.cache.resolve(); inputs = {}
    def raw(path):
        value = path.read_bytes(); inputs[str(path.resolve())] = hashlib.sha256(value).hexdigest(); return value
    proof = json.loads(raw(cache / 'research/navmesh-mask-source-comparison.json'))
    native_path = cache / 'research/navmesh-mask-source-native.json'
    native = json.loads(raw(native_path))
    if proof['mismatches'] or proof['nativeReportSha256'] != inputs[str(native_path.resolve())]:
        raise ValueError('Current independent complete native byte proof required')
    for path, digest in proof['inputs'].items():
        if hashlib.sha256(raw(Path(path))).hexdigest() != digest:
            raise ValueError('Original source proof input changed')
    observation = native['observation']; width, height = observation['width'], observation['height']
    rgba = bytes.fromhex(observation['rgbaHex'])
    if len(rgba) != width * height * 4 or hashlib.sha256(rgba).hexdigest() != observation['sha256']:
        raise ValueError('Exact original source RGBA bytes required')
    plane = Image.frombytes('L', (width, height), rgba[2::4]).convert('RGB')
    plane = plane.resize((width * 3, height * 3), Image.Resampling.NEAREST)
    canvas = Image.new('RGB', (plane.width, plane.height + 64), '#111820')
    canvas.paste(plane, (0, 64)); labels = ImageDraw.Draw(canvas)
    labels.text((8, 7), f'Original CPU RGBA blue plane: {width} x {height}', fill='white')
    labels.text((8, 23), 'Research-selected Map12 base; exact loaded cell flags + original ARGB initializer.', fill='white')
    labels.text((8, 39), 'No GPU upload, blur, decoded map-variant selection, or effect admission proved.', fill='white')
    output = cache / 'visuals/navmesh-mask-source.png'; canvas.save(output)
    raw(Path(__file__))
    for path, digest in inputs.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
            raise ValueError('CPU source visualization input changed')
    report = cache / 'research/navmesh-mask-source-rendering.json'
    report.write_text(json.dumps({'schema': 1, 'kind': 'original-cpu-navmesh-source-byte-visualization',
        'inputs': inputs, 'image': str(output), 'imageSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'sourceWidth': width, 'sourceHeight': height,
        'scope': {'originalCpuBlueBytesVisualized': True, 'nearestDiagnosticMagnification': 3,
                  'gpuTextureOrEffectRendering': False, 'runtimeAdmissionChanged': False,
                  'decodedReplayMapVariant': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'image': str(output), 'report': str(report)}))


if __name__ == '__main__': main()
