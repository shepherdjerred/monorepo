"""Plot original descriptor inputs without assigning unproven visual semantics."""
import argparse
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
    proof_path = args.cache / 'research/effect-descriptor-comparison.json'
    raw = proof_path.read_bytes(); proof = json.loads(raw)
    if proof['mismatches'] or proof['scope']['factoryExecuted'] or proof['scope']['renderingIntegrated']:
        raise ValueError('Unexpected descriptor proof scope')
    c, records = proof['counts'], proof['records']
    bg, fg, muted = '#09131d', '#e4edf4', '#9cb1c4'
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': fg, 'axes.labelcolor': muted,
        'xtick.color': muted, 'ytick.color': muted, 'axes.edgecolor': '#314354', 'font.size': 10})
    fig = plt.figure(figsize=(15, 10), facecolor=bg)
    fig.text(.055, .955, 'Creation requests carry more than an effect and a position', fontsize=22, weight='bold')
    fig.text(.055, .917, 'Original packet-to-descriptor code in native and WASM · build 16.21.829.8620 · first 120 seconds of the ARAM: Mayhem fixture', fontsize=11, color=muted)
    metrics = [(.055, c['bytesCompared'], 'descriptor bytes match'), (.31, c['nondefaultScalar78'], 'non-default scalar 0x78'),
        (.565, c['nondefaultScalar7c'], 'non-default scalar 0x7c'), (.795, c['nonzeroVector6c'], 'nonzero vectors at 0x6c')]
    for x, value, label in metrics:
        fig.text(x, .852, f'{value:,}', fontsize=29, weight='bold', color='#59d9b3')
        fig.text(x, .82, label, fontsize=10.5, color=muted)
    axes = [fig.add_axes([.085, .565, .86, .18], facecolor=bg), fig.add_axes([.085, .315, .86, .18], facecolor=bg)]
    for ax, key, color in zip(axes, ['scalar78', 'scalar7c'], ['#59d9b3', '#79acff']):
        changed = [record for record in records if record['scalarBits'][key] != 0x3f800000]
        ax.axhline(1, color=muted, linestyle='--', linewidth=1, alpha=.6, label='Default value: 1')
        ax.scatter([record['time'] for record in changed], [record[key] for record in changed], color=color, s=16, alpha=.8, linewidths=0)
        ax.set_xlim(0,120); ax.set_xlabel('Recorded match time (s)'); ax.set_ylabel(f"Scalar input 0x{key[-2:]}")
        ax.set_title(f'{len(changed)} requests differ from the default', color=fg, loc='left', fontsize=11)
        ax.spines[['top','right']].set_visible(False); ax.grid(axis='y', alpha=.12)
    fig.text(.055, .235, f"{len(c['flagCounts'])} observed flag combinations · {c['nonzeroScalarA0']:,} nonzero inputs at 0xa0 · {c['auxiliaryContextIds']:,} auxiliary context IDs retained", fontsize=12, weight='bold')
    fig.text(.055, .175, 'The decoder preserves original values and mutated scratch-entry bytes; it leaves the uploaded observation unchanged.', fontsize=11)
    fig.text(.055, .13, 'Live entity pointers are explicit zero inputs. Auxiliary contexts remain unresolved IDs. No resource registry or factory executes here.', fontsize=10.5, color=muted)
    fig.text(.055, .085, 'Scalar offsets are ABI names, not promises about their visual meaning. Original downstream setters, transforms and live context still need composition.', fontsize=10.5, color=muted)
    fig.text(.055, .045, 'CPU / event evidence only. No new effects rendered, browser acceptance or League reference comparison.', fontsize=10, color=muted)
    destination = args.cache / 'public/evidence/latest-effect-descriptor.png'
    fig.savefig(destination, dpi=150, facecolor=bg); plt.close(fig)
    result = {'schema': 1, 'kind': 'particle-descriptor-input-visual', 'build': proof['build'],
        'comparisonSha256': hashlib.sha256(raw).hexdigest(), 'rendererSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'imageSha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'counts': c, 'scope': proof['scope']}
    destination.with_suffix('.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'image': str(destination), 'sha256': result['imageSha256']}))


if __name__ == '__main__':
    main()
