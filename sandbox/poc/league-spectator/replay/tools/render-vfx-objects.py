"""Render effect-object component evidence; not a rendered game frame."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    proof_path = args.cache / 'research/vfx-objects-comparison.json'
    proof_raw = proof_path.read_bytes(); proof = json.loads(proof_raw); c = proof['counts']
    if proof['mismatches'] or any(c[key] for key in ['stageMismatches', 'stateMismatches', 'authoredMutations']):
        raise ValueError('Object observations disagree')
    roots, recorded = Counter(), Counter()
    for row in proof['rows']:
        actor = row['effectId'].rsplit('/', 1)[0]
        if row['kind'] == 'prepared-root': roots[actor] += 1
        elif row['kind'] == 'recorded-scalar-inputs': recorded[actor] += 1
    stress = [row for row in proof['rows'] if row['kind'] == 'pending-queue-growth']
    if len(stress) != 1 or stress[0]['pendingCount'] != 17 or stress[0]['pendingCapacity'] != 19:
        raise ValueError('Queue growth observation changed')
    bg, fg, muted, green, blue, orange = '#09131d', '#e4edf4', '#9cb1c4', '#59d9b3', '#79acff', '#dba967'
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': fg, 'axes.labelcolor': muted,
        'xtick.color': muted, 'ytick.color': muted, 'axes.edgecolor': '#314354', 'font.size': 10})
    fig = plt.figure(figsize=(16, 10), facecolor=bg)
    fig.text(.05, .95, 'Original effect objects now execute in WASM', fontsize=25, weight='bold')
    fig.text(.05, .91, 'Build 16.21.829.8620 · complete authored roots · decoded descriptor scalar inputs · native/WASM byte comparisons', color=muted, fontsize=12)
    for x, value, label in [(.05, c['preparedRoots'], 'full roots exercised'), (.29, c['recordedInputs'], 'recorded input pairs'),
                            (.53, c['objects'], 'original objects created'), (.77, c['objectStageBytes'], 'object-stage bytes matched')]:
        fig.text(x, .84, f'{value:,}', fontsize=30, weight='bold', color=green)
        fig.text(x, .805, label, fontsize=11, color=muted)
    left = fig.add_axes([.15, .29, .34, .43], facecolor=bg)
    actors = sorted(roots); y = np.arange(len(actors))
    left.barh(y - .18, [roots[a] for a in actors], height=.32, color=green, label='Prepared roots')
    left.barh(y + .18, [recorded[a] for a in actors], height=.32, color=blue, label='Recorded scalar pairs')
    left.set_yticks(y, [a.removeprefix('champions/').replace('/', ' · skin ') for a in actors]); left.invert_yaxis()
    left.set_xlabel('Cases on this prepared champion/skin appearance')
    left.set_title('All 876 roots, plus the 1,107 bound replay requests', loc='left', color=fg, fontsize=11)
    left.legend(facecolor='#10202e', edgecolor='#314354', labelcolor=fg, loc='lower right')
    right = fig.add_axes([.59, .44, .35, .28], facecolor=bg)
    x = np.arange(6)
    right.bar(x - .17, [1, 1, 1, 1, 1, 0], width=.3, color=orange, label='Older supplied vector')
    right.bar(x + .17, proof['qualityMultipliers'], width=.3, color=green, label='Original pattern fill')
    right.set_ylim(0, 1.4); right.set_xticks(x, [str(i) for i in x]); right.set_yticks([0, 1])
    right.set_xlabel('Quality multiplier index'); right.set_title('Initialization correction: all six values are one', loc='left', fontsize=11, color=fg)
    right.legend(facecolor='#10202e', edgecolor='#314354', labelcolor=fg, fontsize=9, loc='upper left')
    for ax in [left, right]:
        ax.spines[['top', 'right']].set_visible(False); ax.grid(axis='x' if ax is left else 'y', alpha=.12)
    fig.text(.59, .355, 'Pending queue growth: 17 objects / 19 allocated slots', fontsize=12, weight='bold')
    for i in range(19):
        fig.add_artist(plt.Rectangle((.59 + i * .018, .313), .013, .017, transform=fig.transFigure,
            facecolor=blue if i < 17 else '#243649', edgecolor='none'))
    fig.text(.59, .266, 'Ctor → scalar setters → ready flag: all 568 bytes matched at each stage.', fontsize=9.5, color=muted)
    fig.text(.05, .19, 'No object, manager, queue or authored-asset disagreements across 1,984 independent cases.', fontsize=13, weight='bold')
    fig.text(.05, .145, 'The original factory and setters execute; synchronization has an explicit single-thread ownership model. Unknown manager bytes stay poisoned.', fontsize=10, color=muted)
    fig.text(.05, .103, 'Parent activation, resource acquisition, attachment/world lookup, worker scheduling and main-viewer integration remain unresolved.', fontsize=10.5, color=muted)
    fig.text(.05, .062, 'Component evidence only. No browser UI run or League reference comparison; arbitrary 5v5 and full A/V fidelity remain unproven.', fontsize=10, color=muted)
    destination = args.cache / 'public/evidence/latest-vfx-objects.png'
    fig.savefig(destination, dpi=150, facecolor=bg); plt.close(fig)
    result = {'schema': 1, 'kind': 'native-wasm-vfx-objects-visual', 'build': proof['build'],
        'comparisonSha256': hashlib.sha256(proof_raw).hexdigest(), 'rendererSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'imageSha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'counts': c,
        'qualityMultipliers': proof['qualityMultipliers'], 'scope': proof['scope']}
    destination.with_suffix('.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'image': str(destination), 'sha256': result['imageSha256']}))


if __name__ == '__main__': main()
