"""Plot original retirement modes without pretending disposal empties the pool."""
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
    native_raw = (args.cache / 'research/vfx-retirement-native.json').read_bytes()
    comparison_raw = (args.cache / 'research/vfx-retirement-comparison.json').read_bytes()
    native, proof = json.loads(native_raw), json.loads(comparison_raw)
    root = Path(__file__).resolve().parent.parent
    if (proof['nativeEvidenceSha256'] != sha(native_raw) or proof['counts']['mismatches'] or proof['mismatches'] or
            proof['counts']['previewMismatches'] or proof['previewMismatches'] or
            proof['inspectorSha256'] != sha(Path(__file__).with_name('inspect-vfx-retirement.mjs').read_bytes())):
        raise ValueError('Native retirement comparison is incomplete or stale')
    for name, expected in proof['sources'].items():
        if sha((root / name).read_bytes()) != expected:
            raise ValueError(f'Retirement source changed: {name}')
    graphs = list(dict.fromkeys(c['ref']['sha256'] for c in native['cases']))
    if len(graphs) != 6:
        raise ValueError('Inspect the changed retirement cohort before revising the figure')
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': '#e8edf6', 'figure.facecolor': '#0e1828',
        'axes.facecolor': '#142338', 'axes.labelcolor': '#d1dded', 'xtick.color': '#a8bad2', 'ytick.color': '#a8bad2', 'axes.edgecolor': '#40536e'})
    fig, axes = plt.subplots(3, 2, figsize=(15, 13))
    fig.subplots_adjust(top=.80, bottom=.18, left=.07, right=.96, hspace=.48, wspace=.22)
    fig.text(.05, .96, 'Native effect retirement: completion and disposal are distinct', fontsize=21, weight='bold')
    fig.text(.05, .925, 'Complete emitter assets · constructor-default parent · supplied 30 Hz clock, seed 1, quality 0 · no League process', fontsize=10.5, color='#b3c6e2')
    counts = proof['counts']
    fig.text(.05, .89, f'{counts["flagChecks"]:,} flag probes · {counts["tickChecks"]:,} native/WASM ticks · 36 checkpoints restored after switching graphs', fontsize=12, color='#b3c6e2')
    colors = {'running': '#91a3bb', 'mode-false': '#f2b475', 'mode-true': '#66d9c1'}
    labels = {'running': 'No retirement request', 'mode-false': 'Native mode false', 'mode-true': 'Native mode true'}
    summary = []
    for axis, digest in zip(axes.flat, graphs, strict=True):
        cohort = [c for c in native['cases'] if c['ref']['sha256'] == digest]
        name = cohort[0]['ref']['effectId'].split('/')[1].capitalize()
        for case in cohort:
            schedule = case['schedule']
            frames = [f for f in case['frames'] if f['output'] is not None]
            times = [f['input']['time'] for f in frames]
            alive = [f['output']['state']['vectors']['life']['count'] for f in frames]
            births = sum(len(f['output']['state']['births']) for f in frames)
            axis.step(times, alive, where='post', color=colors[schedule], linewidth=1.9,
                      linestyle='--' if schedule == 'running' else '-', label=labels[schedule])
            deferred = case['deferredTick']
            remaining = None
            if deferred is not None:
                remaining = case['frames'][deferred]['output']['state']['vectors']['life']['count']
                axis.plot(deferred / 30, remaining, marker='x', color=colors[schedule], markersize=9, markeredgewidth=2)
            summary.append({'graphSha256': digest, 'actor': name, 'schedule': schedule, 'births': births,
                            'deferredTick': deferred, 'poolAliveAtDisposal': remaining, 'peakAlive': max(alive)})
        details = [f'{s["schedule"].removeprefix("mode-")}: {s["deferredTick"]/30:.2f}s / {s["poolAliveAtDisposal"]} alive'
                   for s in summary if s['graphSha256'] == digest and s['deferredTick'] is not None]
        axis.set_title(f'{name} · emitter {cohort[0]["ref"]["emitterIndex"]}\nDeferred disposal — ' + '; '.join(details), color='#e8edf6', fontsize=10.5)
        axis.axvline(1, color='#ced9eb', alpha=.45, linewidth=1)
        axis.set_xlabel('Supplied elapsed seconds'); axis.set_ylabel('Live particles in native pool')
        axis.set_xlim(0, 6); axis.set_ylim(bottom=-.15); axis.grid(alpha=.12)
    handles, legend_labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, legend_labels, loc='upper center', bbox_to_anchor=(.5, .855), ncol=3, frameon=False, fontsize=11)
    fig.text(.05, .115, 'Request at 1.00s. × = native collector transfers the system to deferred disposal; its curve ends there.', fontsize=11)
    cuts = sum(s['poolAliveAtDisposal'] not in [None, 0] for s in summary)
    fig.text(.05, .085, f'{cuts} retirements reach disposal with live pool entries. No forced zero count or fake destructor is inserted.', fontsize=11, color='#f2b475')
    fig.text(.05, .055, 'Exact state/geometry agreement in this cohort, including default JS math. Replay mode binding, full siblings, audio and destruction remain unresolved.', fontsize=9.6, color='#b3c6e2')
    fig.savefig(args.output, dpi=120, facecolor=fig.get_facecolor())
    result = {'schema': 1, 'kind': 'native-system-retirement-visual', 'build': native['build'],
              'rendererSha256': sha(Path(__file__).read_bytes()), 'nativeEvidenceSha256': sha(native_raw),
              'comparisonSha256': sha(comparison_raw), 'imageSha256': sha(args.output.read_bytes()),
              'counts': counts, 'summary': summary, 'disposalsWithLiveParticles': cuts,
              'scope': {'controlledInputs': True, 'gameFrame': False, 'deferredDisposalOnly': True,
                        'destructorExecuted': False, 'replayEventMapping': False, 'mainViewerIntegrated': False,
                        'browserRun': False, 'leagueReferenceCompared': False}}
    args.output.with_suffix('.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'imageSha256': result['imageSha256'], 'disposalsWithLiveParticles': cuts}))


if __name__ == '__main__':
    main()
