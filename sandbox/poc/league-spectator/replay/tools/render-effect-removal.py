"""Visualize decoded replay particle removals and the checked native mode branch."""
import argparse
import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    native_raw = (args.cache / 'research/effect-removal-native.json').read_bytes()
    proof_raw = (args.cache / 'research/effect-removal-comparison.json').read_bytes()
    native, proof = json.loads(native_raw), json.loads(proof_raw)
    if proof['nativeEvidenceSha256'] != sha(native_raw) or proof['mismatches']:
        raise ValueError('Removal comparison missing or stale')
    root = Path(__file__).resolve().parent.parent
    for name, expected in proof['sources'].items():
        if sha((root / name).read_bytes()) != expected:
            raise ValueError(f'Removal source changed: {name}')
    bins = {61: [0] * 60, 62: [0] * 60}
    for record in native['records']:
        if record['reasonByte'] not in bins or not 0 <= record['time'] <= 120:
            raise ValueError('Inspect the changed removal corpus before revising the figure')
        bins[record['reasonByte']][min(59, int(record['time'] // 2))] += 1
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': '#e8edf6', 'figure.facecolor': '#0e1828',
        'axes.facecolor': '#142338', 'axes.labelcolor': '#d1dded', 'xtick.color': '#a8bad2', 'ytick.color': '#a8bad2', 'axes.edgecolor': '#40536e'})
    fig, axes = plt.subplots(2, 1, figsize=(15, 10), gridspec_kw={'height_ratios': [1.3, 1]})
    fig.subplots_adjust(top=.79, bottom=.19, left=.075, right=.95, hspace=.7)
    fig.text(.05, .95, 'A replay event stream recovered: particle-entity removal', fontsize=23, weight='bold')
    fig.text(.05, .90, 'Installed build 16.21.829.8620 · real NA1 replay · first 120 seconds · no League process or computer interaction', fontsize=11, color='#b3c6e2')
    fig.text(.05, .855, '3,755 native/WASM packet matches · 512 original-getter probes · 2,048 original removal-route comparisons', fontsize=12, color='#b3c6e2')
    colors = {61: '#f2b475', 62: '#66d9c1'}
    xs = [i * 2 for i in range(60)]
    axes[0].bar(xs, bins[61], width=1.75, align='edge', color=colors[61], label='Reason 61: request flag 0x800')
    axes[0].bar(xs, bins[62], bottom=bins[61], width=1.75, align='edge', color=colors[62], label='Reason 62: request flag 0x10000000')
    axes[0].set_xlabel('Replay time (seconds)'); axes[0].set_ylabel('Removal records per 2 seconds')
    axes[0].set_xlim(0, 120); axes[0].grid(axis='y', alpha=.12)
    axes[0].legend(frameon=False, loc='upper right')
    axes[1].axis('off')
    rows = [('Replay opcode 187', 'Target ID + reason byte', '#263d5b'),
            ('Resolve particle entity', 'Creation IDs decoded\nWorld lookup unresolved', '#4b3e2b'),
            ('Original removal branch', '61 → flag 0x800\nOther → flag 0x10000000', '#263d5b'),
            ('Original object update', 'Resulting object flags\nselect retirement mode', '#263d5b')]
    for index, (title, subtitle, color) in enumerate(rows):
        x = .12 + index * .245
        axes[1].text(x, .65, title + '\n\n' + subtitle, ha='center', va='center', fontsize=9,
                     wrap=True, bbox={'boxstyle': 'round,pad=.8', 'facecolor': color, 'edgecolor': '#58718e'}, transform=axes[1].transAxes)
        if index < 3:
            axes[1].annotate('', xy=(x + .145, .65), xytext=(x + .105, .65), xycoords='axes fraction',
                             arrowprops={'arrowstyle': '->', 'color': '#a8bad2'})
    fig.text(.05, .14, f"1,176 target IDs; {proof['counts']['creationIdsJoined']} join decoded particle creations. None join missile/world tracks. Repeated requests are retained.", fontsize=11)
    fig.text(.05, .095, 'The main decoder now emits these records; existing event sequences and tracks are preserved byte-for-byte.', fontsize=11, color='#b3c6e2')
    fig.text(.05, .055, 'This is event/CPU evidence, not rendered effects. Creation factories, world lookup/type resolution and missile-presentation binding remain unresolved.', fontsize=10.5, color='#c5b58f')
    fig.savefig(args.output, dpi=120, facecolor=fig.get_facecolor())
    result = {'schema': 1, 'kind': 'particle-removal-stream-visual', 'build': proof['build'],
        'rendererSha256': sha(Path(__file__).read_bytes()), 'nativeEvidenceSha256': sha(native_raw),
        'comparisonSha256': sha(proof_raw), 'imageSha256': sha(args.output.read_bytes()), 'counts': proof['counts'],
        'binSeconds': 2, 'bins': bins, 'scope': {'mainDecoderSourceIntegrated': True, 'gameFrame': False,
            'worldLookupExecuted': False, 'particleCreationJoined': True, 'renderingIntegrated': False,
            'browserRun': False, 'leagueReferenceCompared': False}}
    args.output.with_suffix('.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'imageSha256': result['imageSha256']}))


if __name__ == '__main__':
    main()
