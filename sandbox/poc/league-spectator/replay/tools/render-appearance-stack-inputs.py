"""Render decoded appearance requests as a diagnostic, never gameplay."""
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    root = Path(__file__).resolve().parents[1]
    inputs = {}

    def read(path):
        content = path.read_bytes()
        inputs[str(path)] = sha(content)
        return json.loads(content)

    proof = read(cache/'research/appearance-stack-inputs-comparison.json')
    storage = read(cache/'research/appearance-stack-storage-native.json')
    heroes = read(cache/'research/latest-semantics-effects.json')['heroes']
    for report in [proof,storage]:
        if report['mismatchCount'] != 0 or report['scope']['fullAppearanceTransitionExecuted']:
            raise ValueError('Matching scoped appearance evidence required')
        for path,digest in report['inputs'].items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('Appearance diagnostic input changed: '+path)
        for path,digest in report['sources'].items():
            source = root/path if report is proof else root/'tools'/path
            if sha(source.read_bytes()) != digest:
                raise ValueError('Appearance diagnostic source changed: '+str(source))
    colors = {'push':'#78d5c2','pop':'#84b9ed','clear':'#efc38b'}
    bg, fg = '#101923','#bacbdc'
    fig = plt.figure(figsize=(16,9),facecolor=bg)
    fig.text(.055,.94,'Replay appearance changes: decoded and compared',color='white',fontsize=24,weight='bold')
    fig.text(.055,.895,'Build 16.21.829.8620 | Recorded gameplay requests, not accepted live unit state',color=fg,fontsize=12)
    counts = proof['counts']
    for x,value,label in [(.055,counts['replayPackets'],'push / pop / clear requests'),
                          (.365,counts['wasmGetterComparisons'],'native / WASM getter comparisons'),
                          (.735,storage['counts']['independentReplayPushes'],'original push-storage controls')]:
        fig.text(x,.81,f'{value:,}',color='#78d5c2',fontsize=29,weight='bold')
        fig.text(x,.775,label,color=fg,fontsize=11)
    names = {h['entityId']:h['champion'] for h in heroes}
    present = {r['entityId'] for r in proof['records']}
    entities = sorted((entity for entity in names if entity in present),key=lambda entity:names[entity])
    names[None] = 'Other entities'
    entities.append(None)
    rows = {entity:i for i,entity in enumerate(entities)}
    ax = fig.add_axes([.14,.30,.80,.40],facecolor=bg)
    markers = {'push':'|','pop':'v','clear':'x'}
    for kind,color in colors.items():
        selected = [r for r in proof['records'] if r['kind'] == kind]
        offset = {'push':-.13,'pop':.13,'clear':0}[kind]
        ax.scatter([r['time']/60 for r in selected],[rows[r['entityId'] if r['entityId'] in rows else None]+offset for r in selected],
                   marker=markers[kind],s=65 if kind == 'push' else 18,c=color,linewidths=1.2,label=kind)
    for y in rows.values():
        ax.axhline(y,color='#243444',linewidth=.6,zorder=0)
    ax.set_yticks(list(rows.values()),[names[entity] for entity in entities])
    ax.invert_yaxis()
    ax.set_xlim(0,51)
    ax.tick_params(colors=fg,labelsize=11)
    ax.set_xlabel('Recorded match time (minutes)',color=fg,labelpad=10)
    ax.spines[['top','right','left']].set_visible(False)
    ax.spines['bottom'].set_color('#425263')
    legend = ax.legend(handles=[Line2D([],[],marker=markers[k],linestyle='None',color=c,label=k.title())
                                for k,c in colors.items()],loc='upper center',bbox_to_anchor=(.5,1.14),
                       ncol=3,facecolor=bg,edgecolor='none')
    for text in legend.get_texts():
        text.set_color(fg)
    fig.text(.055,.205,'Verified: packet fields, bounded strings, request seeking, and original push storage before resource projection.',color='#78d5c2',fontsize=12)
    fig.text(.055,.145,'Unresolved: accepted appearance state, active resource selection, attachment poses, and full effect creation.',color='#efc38b',fontsize=12)
    fig.text(.055,.075,'Diagnostic only. No additional preview spells enabled. Original storage controls each start from an independent empty stack.',color=fg,fontsize=11)
    output = cache/'public/evidence/latest-appearance-stack-inputs.png'
    output.parent.mkdir(exist_ok=True,parents=True)
    fig.savefig(output,dpi=100,facecolor=bg)
    plt.close(fig)
    report = {'schema':1,'kind':'appearance-request-diagnostic','inputs':inputs,
              'rendererSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(output.read_bytes()),
              'scope':{'diagnosticOnly':True,'gameplayRendered':False,'mainViewerExpanded':False}}
    output.with_suffix('.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'sha256':report['imageSha256']}))


if __name__ == '__main__':
    main()
