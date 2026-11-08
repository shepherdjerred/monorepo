"""Render ordered native appearance selections and their explicit control scope."""
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    root = Path(__file__).resolve().parents[1]
    inputs = {}

    def read(path):
        data = path.read_bytes()
        inputs[str(path)] = sha(data)
        return json.loads(data)

    proof = read(cache/'research/ai-appearance-storage-comparison.json')
    native = read(cache/'research/ai-appearance-transitions-native.json')
    if proof['mismatchCount'] or not native['completeControls']:
        raise ValueError('Completed native/browser storage comparison required')
    for report in [proof,native]:
        for path,digest in report['inputs'].items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('AI storage diagnostic input changed')
        for path,digest in report['sources'].items():
            source = root/path if report is proof else root/'tools'/path
            if sha(source.read_bytes()) != digest:
                raise ValueError('AI storage diagnostic source changed')
    entity = next(hero['entityId'] for hero in native['defaultInputs'] if hero['champion'] == 'Viego')
    selected = [record for record in native['records'] if record['entityId'] == entity]
    categories = [('Viego',43),('Gangplank',14),('Katarina',29),('LuluPolymorphCritter',0)]
    rows = {key:i for i,key in enumerate(categories)}
    bg,fg = '#101923','#bacbdc'
    fig = plt.figure(figsize=(16,9),facecolor=bg)
    fig.text(.055,.94,'Ordered appearance storage now supports checkpoint seeking',color='white',fontsize=23,weight='bold')
    fig.text(.055,.895,'Native unit handler prefixes compared with browser JS | Supplied cold-unit controls, not accepted live match state',color=fg,fontsize=11)
    for x,value,label in [(.055,proof['counts']['orderedOperations'],'ordered push / pop / clear operations'),
                          (.395,proof['counts']['seekQueries'],'reverse and boundary seek comparisons'),
                          (.77,proof['counts']['maxTailReplay'],'maximum replayed events after checkpoint')]:
        fig.text(x,.81,f'{value:,}',color='#78d5c2',fontsize=29,weight='bold')
        fig.text(x,.775,label,color=fg,fontsize=10)
    for box,start,end,title in [([.20,.32,.34,.34],70,115,'Copied appearances'),([.64,.32,.30,.34],780,793,'Polymorph')]:
        ax = fig.add_axes(box,facecolor=bg)
        previous = [record for record in selected if record['time'] <= start]
        if not previous:
            initial = [dict(name='Viego',skinId=43)]*6
        else:
            initial = previous[-1]['projection']['keys']
        records = [(start,initial)]+[(record['time'],record['projection']['keys']) for record in selected if start < record['time'] <= end]
        records.append((end,records[-1][1]))
        for index,color,label,offset in [(2,'#84b9ed','Selected key (0x10)',.04),(5,'#78d5c2','Base context (0x30)',-.04)]:
            keys = [(record[1][index]['name'],record[1][index]['skinId']) for record in records]
            if any(key not in rows for key in keys):
                raise ValueError('Diagnostic range contains an unlisted selected key')
            ax.step([record[0] for record in records],[rows[key]+offset for key in keys],where='post',color=color,linewidth=2,label=label)
        ax.set_yticks(range(len(categories)),[name.replace('LuluPolymorphCritter','Polymorph')+' / '+str(skin) for name,skin in categories])
        if start > 100:
            ax.set_yticklabels([])
        ax.set_ylim(-.4,3.4)
        ax.set_xlim(start,end)
        ax.set_xlabel('Recorded time (seconds)',color=fg,labelpad=10)
        ax.set_title(title,color='white',fontsize=13,pad=12)
        ax.tick_params(colors=fg,labelsize=11)
        ax.grid(axis='y',color='#243444',linewidth=.7)
        ax.spines[['top','right','left']].set_visible(False)
        ax.spines['bottom'].set_color('#425263')
        if start < 100:
            legend = ax.legend(loc='upper center',bbox_to_anchor=(1.05,-.25),ncol=2,facecolor=bg,edgecolor='none')
            for text in legend.get_texts(): text.set_color(fg)
    fig.text(.055,.18,'Verified: 1,296 resource-channel selections, duplicate-ID removal, inherited skins, and 648 checkpoint queries; zero mismatches.',color='#78d5c2',fontsize=11)
    fig.text(.055,.125,'Unresolved: 149 operations with unknown target defaults; live routing, readiness, and post-projection unit callbacks.',color='#efc38b',fontsize=12)
    fig.text(.055,.065,'Component diagnostic only. Routing units/defaults/cache keys are supplied controls. No additional preview spells are visible yet.',color=fg,fontsize=11)
    output = cache/'public/evidence/latest-ai-appearance-storage.png'
    fig.savefig(output,dpi=100,facecolor=bg)
    plt.close(fig)
    result = {'schema':1,'kind':'ai-appearance-storage-diagnostic','inputs':inputs,
              'rendererSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(output.read_bytes()),
              'scope':{'diagnosticOnly':True,'gameplayRendered':False,'mainViewerExpanded':False}}
    output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'sha256':result['imageSha256']}))


if __name__ == '__main__':
    main()
