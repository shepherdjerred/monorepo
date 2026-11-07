"""Crop an archived mixed capture around explicitly attributed creator draws.

This extracts existing display pixels. It performs no new draw and does not
isolate overlapping effects or establish per-pixel creator ownership.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

import numpy as np
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('version', type=int)
    parser.add_argument('champion')
    args = parser.parse_args()
    if args.version <= 0 or not re.fullmatch('[A-Za-z]+', args.champion):
        raise ValueError('Positive archive version and decoded champion name required')
    cache, inputs = args.cache.resolve(), {}

    def raw(path):
        path = path.resolve()
        data = path.read_bytes()
        inputs[str(path)] = hashlib.sha256(data).hexdigest()
        return data

    def read(path):
        return json.loads(raw(path))

    worker_path = cache/f'research/shared-direct-playback-worker-v{args.version}-final.json'
    raster_path = cache/f'research/shared-direct-playback-offscreen-v{args.version}.json'
    worker, raster = read(worker_path), read(raster_path)
    worker_pins = [v for p, v in raster['inputs'].items() if Path(p).name == 'shared-direct-playback-worker.json']
    if worker_pins != [inputs[str(worker_path)]] or raster['viewport'] != [0, 0, 512, 512]:
        raise ValueError('Raster must bind this exact worker and declared viewport')
    capture_path = cache/f'visuals/shared-direct-playback-v{args.version}.gif'
    raw(capture_path)
    if inputs[str(capture_path)] != raster['capture']['sha256']:
        raise ValueError('Exact archived display capture required')
    selected = [(i, frame, [d for d in frame['draws'] if d['creatorChampion'] == args.champion and d['prefixFramebufferChangedPixels'] > 0])
                for i, frame in enumerate(raster['frames'])]
    selected = [(i, frame, draws) for i, frame, draws in selected if draws]
    if not selected:
        raise ValueError('No explicit contributing creator draws in this archive')
    first, last = max(0, selected[0][0]-1), min(len(raster['frames'])-1, selected[-1][0]+1)
    projection = np.asarray(raster['projection']).reshape(4, 4)
    coordinates = []
    for index, _, draws in selected:
        keys = {(d['sourceEventId'], d['generation'], d['definitionId'], d['emitterId']) for d in draws}
        for draw in worker['snapshots'][index]['draws']:
            if (draw['sourceEventId'], draw['generation'], draw['definitionId'], draw['emitterId']) not in keys:
                continue
            if draw.get('primitive') in ['static-mesh', 'ray']:
                raise ValueError('This display crop supports the ordinary quad/trail vertex contract only')
            vertices = bytes.fromhex(draw['geometry']['verticesHex'])
            for offset in range(0, len(vertices), 28):
                point = projection @ np.asarray([*struct.unpack_from('<3f', vertices, offset), 1])
                coordinates.append([(point[0]/point[3]*.5+.5)*512, (1-(point[1]/point[3]*.5+.5))*512])
    points = np.asarray(coordinates)
    low, high = np.floor(points.min(axis=0)-24), np.ceil(points.max(axis=0)+24)
    center = (low+high)/2
    size = max(96, *(high-low))
    box = [max(0, int(center[0]-size/2)), max(0, int(center[1]-size/2)),
           min(512, int(center[0]+size/2)), min(512, int(center[1]+size/2))]
    if box[2] <= box[0] or box[3] <= box[1]:
        raise ValueError('Creator geometry falls outside this diagnostic viewport')
    source = Image.open(capture_path)
    images, times, durations = [], [], []
    for index in range(first, last+1):
        source.seek(index)
        viewport = source.convert('RGB').crop((74, 50, 586, 562))
        crop = viewport.crop(box).resize((512, 512), Image.Resampling.NEAREST)
        image = Image.new('RGB', (540, 574), '#101822')
        image.paste(crop, (14, 52))
        labels = ImageDraw.Draw(image)
        time = raster['frames'][index]['time']
        labels.text((14, 10), f'{args.champion} missile area / {time:.3f}s', fill='#e9eef7')
        labels.text((14, 28), 'Mixed offscreen capture crop; other effects can overlap.', fill='#a8bdd0')
        images.append(image)
        times.append(time)
        durations.append(raster['capture']['durationsMs'][index])
    stem = f'{args.champion.lower()}-direct-mixed-v{args.version}'
    png, gif = cache/f'visuals/{stem}.png', cache/f'visuals/{stem}.gif'
    best = max(selected, key=lambda row: sum(d['prefixFramebufferChangedPixels'] for d in row[2]))[0]
    images[best-first].save(png)
    images[0].save(gif, save_all=True, append_images=images[1:], duration=durations, loop=0)
    raw(Path(__file__))
    output = cache/f'research/{stem}.json'
    output.write_text(json.dumps({'schema': 1, 'kind': 'archived-mixed-creator-area-display-crop', 'inputs': inputs,
        'champion': args.champion, 'cropViewportPixels': box, 'sourceEventIds': sorted({d['sourceEventId'] for _, _, draws in selected for d in draws}),
        'image': str(png), 'imageSha256': hashlib.sha256(png.read_bytes()).hexdigest(),
        'capture': {'path': str(gif), 'sha256': hashlib.sha256(gif.read_bytes()).hexdigest(), 'replayTimes': times, 'durationsMs': durations},
        'scope': {'existingDisplayPixelsOnly': True, 'newGpuDrawPerformed': False, 'isolatedCreatorPixels': False, 'browserAcceptance': False}}, indent=2))
    print(json.dumps({'output': str(output), 'image': str(png), 'capture': str(gif), 'frames': len(images), 'viewportCrop': box}))


if __name__ == '__main__':
    main()
