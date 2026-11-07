"""Show complete prepared system assets; this is not a game-frame rendering."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    proof_path = args.cache / 'research/vfx-system-assets-comparison.json'
    proof_raw = proof_path.read_bytes(); proof = json.loads(proof_raw); c = proof['counts']
    if proof['mismatches'] or c['nativeIgnoredFields'] or c['nativeTypeMismatches'] or c['pendingLinkFixups'] or proof['scope']['runtimeFactoryExecuted']:
        raise ValueError('Incomplete system asset proof')
    systems, complex_emitters, simple_emitters = Counter(), Counter(), Counter()
    for row in proof['rows']:
        actor = row['effectId'].rsplit('/', 1)[0]
        systems[actor] += 1; complex_emitters[actor] += row['directComplexEmitters']; simple_emitters[actor] += row['directSimpleEmitters']
    actors = sorted(systems)
    bg, fg, muted = '#09131d', '#e4edf4', '#9cb1c4'
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': fg, 'axes.labelcolor': muted,
        'xtick.color': muted, 'ytick.color': muted, 'axes.edgecolor': '#314354', 'font.size': 10})
    fig = plt.figure(figsize=(16, 10), facecolor=bg)
    fig.text(.05, .955, 'Complete authored effect definitions are now preserved', fontsize=24, weight='bold')
    fig.text(.05, .915, f"Build 16.21.829.8620 · {len(actors)} prepared champion/skin appearances · original field loading and post-load callbacks", color=muted, fontsize=12)
    for x, value, label in [(.05, c['systems'], 'complete system roots'), (.29, c['directComplexEmitters'], 'complex emitters'),
                            (.53, c['directSimpleEmitters'], 'simple emitters retained'), (.77, c['callbackVisits'], 'native callback visits')]:
        fig.text(x, .845, f'{value:,}', fontsize=31, weight='bold', color='#59d9b3')
        fig.text(x, .813, label, fontsize=11, color=muted)
    left = fig.add_axes([.13, .25, .34, .48], facecolor=bg)
    right = fig.add_axes([.63, .25, .32, .48], facecolor=bg)
    ys = list(range(len(actors))); labels = [actor.removeprefix('champions/').replace('/', ' · skin ') for actor in actors]
    left.barh(ys, [systems[actor] for actor in actors], color='#59d9b3', height=.7)
    right.barh(ys, [complex_emitters[actor] for actor in actors], color='#79acff', height=.7, label='Complex')
    right.barh(ys, [simple_emitters[actor] for actor in actors], left=[complex_emitters[actor] for actor in actors], color='#dba967', height=.7, label='Simple')
    for ax in [left, right]:
        ax.invert_yaxis(); ax.set_yticks(ys, labels); ax.spines[['top', 'right']].set_visible(False); ax.grid(axis='x', alpha=.12)
    left.set_xlabel('Complete effect definitions'); right.set_xlabel('Emitter definitions inside the full roots')
    left.set_title('Every definition in the prepared effect package', loc='left', fontsize=12, color=fg)
    right.set_title('Parent + complex/simple lists loaded together', loc='left', fontsize=12, color=fg)
    right.legend(loc='lower right', facecolor='#10202e', edgecolor='#314354', labelcolor=fg)
    fig.text(.05, .165, f"{c['serializedFields']:,} serialized root fields · no ignored fields, type mismatches or pending link fixups · {c['replayPreparedResources']:,} resolved replay requests have full roots", fontsize=12, weight='bold')
    fig.text(.05, .112, 'Prepared graphs preserve authored parent data, materials, strings and all nested typed objects. The browser inventory checks their bytes and ownership.', fontsize=10.5, color=muted)
    fig.text(.05, .075, 'Static build preparation only: complete runtime activation, resource acquisition, attachments, rendering and synchronized A/V comparison remain unresolved.', fontsize=10.5, color=muted)
    fig.text(.05, .038, 'This covers the current prepared appearances; it does not establish arbitrary 5v5 support or a visual-fidelity percentage.', fontsize=10, color=muted)
    destination = args.cache / 'public/evidence/latest-vfx-system-assets.png'
    fig.savefig(destination, dpi=150, facecolor=bg); plt.close(fig)
    result = {'schema': 1, 'kind': 'complete-system-assets-visual', 'build': proof['build'],
        'comparisonSha256': hashlib.sha256(proof_raw).hexdigest(), 'rendererSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'imageSha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'counts': c,
        'actors': [{'actor': actor, 'systems': systems[actor], 'complexEmitters': complex_emitters[actor], 'simpleEmitters': simple_emitters[actor]} for actor in actors],
        'scope': proof['scope']}
    destination.with_suffix('.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'image': str(destination), 'sha256': result['imageSha256']}))


if __name__ == '__main__':
    main()
