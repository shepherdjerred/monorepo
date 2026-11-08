"""Render replay-derived creation/catalog/removal evidence, not a game frame."""
import argparse
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
    def load(path): return json.loads(path.read_bytes())
    def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
    proof_path = args.cache / 'research/effect-creation-comparison.json'
    report_path = args.cache / 'research/latest-semantics-creations.json'
    proof, report = load(proof_path), load(report_path)
    if proof['reconstructionSha256'] != sha(report_path) or proof['mismatches']:
        raise ValueError('Creation evidence changed')
    bindings = {b['creationSequence']: b for b in proof['bindings']}
    bins = list(range(0, 121, 2))
    prepared = [r['time'] for r in report['effectCreations'] if bindings[r['creationSequence']]['status'] == 'prepared-context-resource']
    unresolved = [r['time'] for r in report['effectCreations'] if bindings[r['creationSequence']]['status'] != 'prepared-context-resource']
    prepared_bins = np.histogram(prepared, bins)[0]
    unresolved_bins = np.histogram(unresolved, bins)[0]
    bg, fg, muted = '#09131d', '#e4edf4', '#9cb1c4'
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': fg, 'axes.labelcolor': fg,
        'xtick.color': muted, 'ytick.color': muted, 'axes.edgecolor': '#314354', 'font.size': 11})
    fig = plt.figure(figsize=(15, 9), facecolor=bg)
    fig.text(.055, .955, 'Replay particle creation: identity → resource → removal request', fontsize=21, weight='bold')
    fig.text(.055, .92, 'Build 16.21.829.8620 · real ARAM: Mayhem replay · first 120 seconds · original native getters compared with WASM', color=muted, fontsize=11)
    c = proof['counts']
    for x, value, label in [(.055, c['entryChecks'], 'creation records'), (.29, c['bindingCounts']['prepared-context-resource'], 'prepared context resources'),
                            (.525, c['createdIdsWithRemoval'], 'IDs joined to removal'), (.76, c['mixedChecks'], 'mixed getter probes')]:
        fig.text(x, .855, f'{value:,}', fontsize=28, color='#59d9b3', weight='bold')
        fig.text(x, .825, label, color=muted, fontsize=11)
    ax = fig.add_axes([.075, .45, .88, .30], facecolor=bg)
    ax.bar(bins[:-1], prepared_bins, width=2, align='edge', color='#59d9b3', label='Prepared resource in explicit context skin')
    ax.bar(bins[:-1], unresolved_bins, bottom=prepared_bins, width=2, align='edge', color='#dba967', label='Unresolved context/key or explicit null resource')
    ax.set_xlim(0, 120); ax.set_ylabel('Creation records / 2 s'); ax.set_xlabel('Recorded match time (s)')
    ax.spines[['top', 'right']].set_visible(False)
    ax.legend(loc='upper left', facecolor='#10202e', edgecolor='#314354', labelcolor=fg, fontsize=10)
    ax.grid(axis='y', alpha=.13)
    # Native stop requests can drain particles. Do not turn a request into a
    # fabricated disposal time or show these spans as actual rendered lifetimes.
    first_requests = {}
    for request in proof['removalRequests']:
        if request['status'] == 'creation-before-removal-request':
            first_requests.setdefault(request['creationSequence'], request)
    selected, actors = [], set()
    for record in report['effectCreations']:
        binding = bindings[record['creationSequence']]
        request = first_requests.get(record['creationSequence'])
        if binding['status'] != 'prepared-context-resource' or not request or binding['actorKey'] in actors:
            continue
        if request['time'] - record['time'] < .05: continue
        actors.add(binding['actorKey']); selected.append((record, binding, request))
        if len(selected) == 6: break
    lower = fig.add_axes([.22, .145, .735, .20], facecolor=bg)
    labels, spans = [], []
    for index, (record, binding, request) in enumerate(selected):
        start, end = record['time'], request['time']
        lower.plot([start, end], [index, index], color='#79acff', linewidth=3)
        lower.scatter([start], [index], marker='o', color='#59d9b3', zorder=3)
        lower.scatter([end], [index], marker='x', color='#edb778', zorder=3)
        labels.append(f"{binding['actorKey'].split('/')[1]} · {record['entityId']:08x}")
        spans.append({'entityId': record['entityId'], 'creationSequence': record['creationSequence'], 'start': start, 'firstRemovalRequest': end})
    lower.set_yticks(range(len(labels)), labels); lower.invert_yaxis(); lower.set_xlim(0, 120)
    lower.set_xlabel('Creation (●) to first removal request (×); disposal time is not inferred')
    lower.spines[['top', 'right']].set_visible(False); lower.grid(axis='x', alpha=.13)
    fig.text(.055, .382, 'Identity joins now exist. Rendering still needs original placement, attachment overrides and factory state.', fontsize=12, weight='bold')
    fig.text(.055, .045, 'No browser run or League reference comparison. No new effects rendered by this change. Map conversion, world lookup and factory execution remain unresolved.', fontsize=10, color=muted)
    destination = args.cache / 'public/evidence/latest-effect-creation.png'
    destination.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(destination, dpi=150, facecolor=bg); plt.close(fig)
    metadata = {'schema': 1, 'kind': 'particle-creation-evidence-visual', 'build': report['build'],
        'comparisonSha256': sha(proof_path), 'reconstructionSha256': sha(report_path),
        'rendererSha256': sha(Path(__file__)), 'imageSha256': sha(destination), 'counts': c,
        'binEdges': bins, 'preparedBins': prepared_bins.tolist(), 'unresolvedBins': unresolved_bins.tolist(), 'requestSpans': spans,
        'scope': proof['scope']}
    destination.with_suffix('.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(json.dumps({'image': str(destination), 'sha256': metadata['imageSha256'], 'spans': len(spans)}))


if __name__ == '__main__':
    main()
