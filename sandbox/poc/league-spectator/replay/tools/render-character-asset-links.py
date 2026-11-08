"""Render the installed shared-asset and original typed-reference evidence."""
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('--actor',action='append',required=True)
    args = p.parse_args()
    cache = args.cache.resolve()
    root = Path(__file__).resolve().parents[1]
    inputs = {}
    def read(path):
        data = path.read_bytes()
        inputs[str(path)] = sha(data)
        return json.loads(data)
    shared = read(cache/'research/global-asset-inputs/index.json')
    for path,digest in shared['sources'].items():
        if sha((root/path).read_bytes()) != digest:
            raise ValueError('Shared asset diagnostic producer changed')
    for job in shared['jobs']:
        for path,digest in [(job['source'],job['sha256']),(job['output'],job['jsonSha256'])]:
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('Shared asset diagnostic bytes changed')
    reports = []
    for actor in args.actor:
        report = read(cache/'research'/('character-asset-links-'+actor.replace('/','-')+'-native.json'))
        for path,digest in report['inputs'].items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('Character graph diagnostic input changed')
        for path,digest in report['sources'].items():
            if sha((root/'tools'/path).read_bytes()) != digest:
                raise ValueError('Character graph diagnostic producer changed')
        reports.append(report)
    bg,fg,muted,green,amber = '#101923','#e3edf7','#9caec2','#78d5c2','#efc38b'
    fig = plt.figure(figsize=(16,9),facecolor=bg)
    fig.text(.055,.93,'Shared assets found; original character dependency graphs',color=fg,fontsize=23,weight='bold')
    fig.text(.055,.885,'Exact installed build '+shared['build']+' | Native constructors and typed readers | Component research',color=muted,fontsize=12)
    labels = {'shared':'Shared spells / effects','emblems':'Emblems','perks':'Runes / perks','globals':'Global definitions',
              'data/shaders/shaders.bin':'Shader definitions','assets/shaders/shareddata.bin':'Shading models',
              'data/maps/shipping/map30/map30.bin':'Map 30 definitions'}
    stats = shared['parser']['results']
    for index,source in enumerate(stats):
        x = .055+index*.13
        fig.text(x,.79,f"{source['objects']:,}",color=green,fontsize=26,weight='bold')
        fig.text(x,.75,labels[source['path']],color=muted,fontsize=10)
    fig.text(.055,.67,'Original typed dependency reads',color=fg,fontsize=16,weight='bold')
    for index,report in enumerate(reports):
        y = .585-index*.105
        counts = report['counts']
        complete = report['scope']['referenceLinksFixed'] and not report['boundaries']
        color = green if complete else amber
        name = report['actorKey'].split('/')[1].capitalize()
        fig.text(.055,y,name,color=fg,fontsize=14,weight='bold')
        fig.text(.22,y,f"{counts['loadedRoots']:,} roots read",color=color,fontsize=14)
        fig.text(.43,y,f"{counts['fixedReferences']:,} links fixed",color=color,fontsize=14)
        fig.text(.64,y,f"{counts['originalSkippedFields']:,} native skips",color=muted,fontsize=12)
        state = 'Reference graph resolved' if complete else f"{counts['boundaries']} explicit boundaries"
        fig.text(.79,y,state,color=color,fontsize=12)
    stages = [('Installed bytes',green),('Typed reads',green),('Reference links',green if all(r['scope']['referenceLinksFixed'] for r in reports) else amber),
              ('Ready assets',muted),('Unit callbacks',muted),('Replay effects',muted)]
    for index,(label,color) in enumerate(stages):
        x = .055+index*.15
        fig.patches.append(FancyBboxPatch((x,.21),.13,.055,boxstyle='round,pad=0.006',transform=fig.transFigure,
                                        edgecolor=color,facecolor=bg,linewidth=1.4))
        fig.text(x+.065,.231,label,color=color,fontsize=10,ha='center')
    fig.text(.055,.125,'Native parser skips remain explicit. Fixed pointers do not establish asset readiness or complete post-load behavior.',color=amber,fontsize=12)
    fig.text(.055,.065,'Diagnostic only. No additional spells enabled in the main replay. Browser playback and League reference comparison were not run.',color=muted,fontsize=11)
    output = cache/'public/evidence/latest-character-asset-links.png'
    fig.savefig(output,dpi=100,facecolor=bg)
    plt.close(fig)
    result = {'schema':1,'kind':'character-asset-links-diagnostic','inputs':inputs,
              'rendererSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(output.read_bytes()),
              'scope':{'diagnosticOnly':True,'gameplayRendered':False,'mainViewerExpanded':False}}
    output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'sha256':result['imageSha256']}))


if __name__ == '__main__':
    main()
