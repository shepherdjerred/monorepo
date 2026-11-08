"""Plot original packet positions; attachment/factory transforms are not applied."""
import argparse
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    inputs = {}
    def read(path):
        data = path.read_bytes(); inputs[str(path.resolve())] = hashlib.sha256(data).hexdigest()
        return data
    def load(path): return json.loads(read(path))
    proof_path = args.cache / 'research/effect-placement-comparison.json'
    proof = load(proof_path)
    scene = load(args.cache / 'public/latest-scene/manifest.json')
    creation = load(args.cache / 'research/effect-creation-comparison.json')
    heights = np.frombuffer(read(args.cache / 'public/latest-scene/heights.bin'), dtype='<f4')
    grid = scene['map']['heightGrid']; heights = heights.reshape(grid['z'], grid['x'])
    if proof['mismatches'] or proof['scope']['renderingIntegrated'] or proof['scope']['attachmentPoseExecuted']:
        raise ValueError('Unexpected placement proof scope')
    minimum, maximum = scene['map']['min'], scene['map']['max']
    records = proof['records']; colors = []
    for r in records:
        binding = creation['bindings'][r['creationSequence']]
        if binding['entityId'] != r['entityId']: raise ValueError('Creation identity changed')
        colors.append('#59d9b3' if binding['status'] == 'prepared-context-resource' else '#dba967')
    positions = np.asarray([r['primaryPacketPosition'] for r in records])
    outside = [r['creationSequence'] for r in records if not (minimum[0] <= r['primaryPacketPosition'][0] <= maximum[0] and
        minimum[2] <= r['primaryPacketPosition'][2] <= maximum[2])]
    bg, fg, muted = '#09131d', '#e4edf4', '#9cb1c4'
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': fg, 'axes.labelcolor': muted,
        'xtick.color': muted, 'ytick.color': muted, 'axes.edgecolor': '#314354', 'font.size': 10})
    fig = plt.figure(figsize=(15, 10), facecolor=bg)
    fig.text(.055, .955, 'Particle packet positions in native world coordinates', fontsize=23, weight='bold')
    fig.text(.055, .915, 'Build 16.21.829.8620 · ARAM: Mayhem fixture · first 120 seconds · before entity, visibility and attachment processing', color=muted, fontsize=11)
    for x, value, label in [(.055, f"{proof['counts']['vectors']:,}", 'three vectors / creation request'), (.355, f"{proof['counts']['floatChecks']:,}", 'float lanes match native bits'),
                            (.655, f"{proof['counts']['gridChecks']:,}", 'signed16 coordinate conversions match')]:
        fig.text(x, .855, value, fontsize=29, color='#59d9b3', weight='bold')
        fig.text(x, .825, label, color=muted, fontsize=11)
    ax = fig.add_axes([.065, .18, .52, .58], facecolor=bg)
    extent = [minimum[0], minimum[0] + (grid['x'] - 1) * grid['step'][0], minimum[2], minimum[2] + (grid['z'] - 1) * grid['step'][1]]
    ax.imshow(heights, extent=extent, origin='lower', cmap='bone', alpha=.24, interpolation='nearest')
    for prepared, color, label in [(False, '#dba967', 'Unresolved/null resource'), (True, '#59d9b3', 'Prepared context resource')]:
        indices = [i for i, c in enumerate(colors) if (c == '#59d9b3') == prepared]
        ax.scatter(positions[indices, 0], positions[indices, 2], color=color, s=8, alpha=.50, linewidths=0, label=label)
    # Include every primary packet position, including the 103 beyond nav bounds.
    ax.add_patch(Rectangle((minimum[0], minimum[2]), maximum[0]-minimum[0], maximum[2]-minimum[2], fill=False, edgecolor='#79acff', linewidth=1, label='Prepared navigation bounds'))
    ax.set_xlabel('Native world X'); ax.set_ylabel('Native world Z'); ax.set_aspect('equal', adjustable='datalim')
    ax.set_title('Primary packet position · navigation height backdrop', color=fg, fontsize=12)
    ax.legend(loc='upper left', facecolor='#10202e', edgecolor='#314354', labelcolor=fg, fontsize=8)
    ax.spines[['top','right']].set_visible(False)
    side = fig.add_axes([.64, .22, .31, .50], facecolor=bg); side.axis('off')
    rows = [
        ('Original map initialization', f"Origin: {tuple(scene['map']['movementOrigin'])}\nGrid scale: 2 game units"),
        ('Complete packet-vector decoding', f"{proof['counts']['entryChecks']:,} requests × 3 vectors\nNo float-lane mismatches"),
        ('References remain significant', f"{proof['counts']['attachmentEntityReferences']:,} nonzero attachment IDs\nVisibility / live poses still required"),
        ('No bounds-based suppression', f'{len(outside)} primary positions exceed nav bounds\nAll remain in the evidence and plot'),
    ]
    for index, (title, detail) in enumerate(rows):
        y = .94 - index * .245
        side.text(0, y, title, fontsize=13, weight='bold', va='top')
        side.text(0, y-.065, detail, fontsize=11, color=muted, va='top', linespacing=1.5)
    fig.text(.055, .105, 'Native call tracing: the third vector can update another entity’s position when its visibility predicate is false.', fontsize=11)
    fig.text(.055, .068, 'These are decoded packet positions, not final rendered effects. Factories, live attachments, visibility state and A/V reference validation remain open.', color=muted, fontsize=10)
    destination = args.cache / 'public/evidence/latest-effect-placement.png'
    fig.savefig(destination, dpi=150, facecolor=bg); plt.close(fig)
    result = {'schema': 1, 'kind': 'particle-packet-placement-visual', 'build': proof['build'],
        'comparisonSha256': inputs[str(proof_path.resolve())], 'rendererSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'imageSha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'inputs': inputs, 'counts': proof['counts'],
        'outsideNavigationBounds': outside, 'scope': proof['scope']}
    destination.with_suffix('.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'image': str(destination), 'sha256': result['imageSha256'], 'outside': len(outside)}))


if __name__ == '__main__':
    main()
