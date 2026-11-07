"""Plot native continuous emission under supplied suspension/resume controls."""
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
    for name in ['native', 'comparison', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    native_raw, comparison_raw = args.native.read_bytes(), args.comparison.read_bytes()
    native, comparison = json.loads(native_raw), json.loads(comparison_raw)
    if (comparison['nativeEvidenceSha256'] != sha(native_raw) or comparison['counts']['mismatches'] or comparison['mismatches'] or
            comparison['inspectorSha256'] != sha(Path(__file__).with_name('inspect-vfx-control.mjs').read_bytes())):
        raise ValueError('Native control comparison is incomplete or stale')
    root = Path(__file__).resolve().parent.parent
    for name, expected in comparison['sources'].items():
        if sha((root / name).read_bytes()) != expected:
            raise ValueError(f'Control component source changed: {name}')
    for name, expected in native['sources'].items():
        if sha(Path(__file__).with_name(name).read_bytes()) != expected:
            raise ValueError(f'Control native source changed: {name}')
    graphs = list(dict.fromkeys(case['graphSha256'] for case in native['cases']))
    if len(graphs) != 6:
        raise ValueError('Inspect the changed native continuous cohort before changing its figure')
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': '#e8edf6', 'figure.facecolor': '#0e1828',
                         'axes.facecolor': '#142338', 'axes.labelcolor': '#d1dded', 'xtick.color': '#a8bad2', 'ytick.color': '#a8bad2',
                         'axes.edgecolor': '#40536e'})
    fig, axes = plt.subplots(3, 2, figsize=(15, 13))
    fig.subplots_adjust(top=.80, bottom=.18, left=.07, right=.96, hspace=.45, wspace=.22)
    fig.text(.05, .96, 'Native continuous particles: suspend births, retain the tail, resume', fontsize=21, weight='bold')
    fig.text(.05, .925, 'Controlled inputs · complete installed assets · supplied 30 Hz clock, seed 1 and quality 0 · no League process', fontsize=11, color='#b3c6e2')
    fig.text(.05, .89, '1,024 flag probes + 3,060 native/WASM frame comparisons; 864 frames restored after switching graphs', fontsize=12, color='#b3c6e2')
    colors = {'running': '#91a3bb', 'suspend-drain': '#f2b475', 'suspend-resume': '#66d9c1'}
    labels = {'running': 'No suspension', 'suspend-drain': 'Suspend at 0.30s; let particles drain', 'suspend-resume': 'Suspend at 0.30s; resume at 1.20s'}
    summary = []
    for axis, graph in zip(axes.flat, graphs, strict=True):
        cohort = [case for case in native['cases'] if case['graphSha256'] == graph]
        name = cohort[0]['ref']['effectId'].split('/')[1].capitalize()
        for schedule in ['running', 'suspend-drain', 'suspend-resume']:
            case = next(case for case in cohort if case['schedule'] == schedule)
            times = [frame['input']['time'] for frame in case['frames']]
            counts = [frame['output']['state']['vectors']['life']['count'] for frame in case['frames']]
            births = [len(frame['output']['state']['births']) for frame in case['frames']]
            axis.step(times, counts, where='post', color=colors[schedule], linewidth=2.1, linestyle='--' if schedule == 'running' else '-', label=labels[schedule])
            summary.append({'graphSha256': graph, 'actor': name, 'schedule': schedule, 'births': sum(births), 'peakAlive': max(counts),
                            'aliveAt1Second': counts[30], 'aliveAt2Seconds': counts[60], 'birthsAtResume': births[36]})
        axis.axvline(.3, color='#f2b475', alpha=.5, linewidth=1)
        axis.axvline(1.2, color='#66d9c1', alpha=.5, linewidth=1)
        axis.set_title(f'{name} · emitter {cohort[0]["ref"]["emitterIndex"]} · rate {cohort[0]["rate"]:g}/s', color='#e8edf6', fontsize=12)
        axis.set_xlabel('Elapsed seconds'); axis.set_ylabel('Live particles'); axis.set_xlim(0, 2); axis.set_ylim(bottom=0)
        axis.grid(alpha=.12)
    handles, legend_labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, legend_labels, loc='upper center', bbox_to_anchor=(.5, .855), ncol=3, frameon=False, fontsize=10)
    fig.text(.05, .115, 'All original frame bytes agree when host-library results are replayed after exact argument checks.', fontsize=11)
    fig.text(.05, .085, 'Default JS math: 3 persistent-state differences / 1,098 frames; no geometry differences in this cohort. Zero tolerance is retained.', fontsize=10, color='#c5b58f')
    fig.text(.05, .055, 'Emission suspension is reversible. System retirement, replay-event binding, scene audio/mesh siblings and main-viewer integration remain separate.', fontsize=10, color='#c5b58f')
    fig.savefig(args.output, dpi=120, facecolor=fig.get_facecolor())
    result = {'schema': 1, 'kind': 'native-emission-control-visual', 'build': native['build'], 'rendererSha256': sha(Path(__file__).read_bytes()),
        'nativeEvidenceSha256': sha(native_raw), 'comparisonSha256': sha(comparison_raw), 'imageSha256': sha(args.output.read_bytes()),
        'counts': comparison['counts'], 'summary': summary,
        'scope': {'controlledInputs': True, 'gameFrame': False, 'systemRetirement': False, 'replayEventMapping': False,
            'browserRun': False, 'mainViewerIntegrated': False, 'leagueReferenceCompared': False}}
    args.output.with_suffix('.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'graphs': len(graphs), 'imageSha256': result['imageSha256']}))


if __name__ == '__main__':
    main()
