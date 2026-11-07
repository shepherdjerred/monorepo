"""Render compared appearance/base resource selections, not gameplay."""
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
    args = p.parse_args()
    cache = args.cache.resolve()
    root = Path(__file__).resolve().parents[1]
    inputs = {}

    def read(path):
        content = path.read_bytes()
        inputs[str(path)] = sha(content)
        return json.loads(content)

    proof = read(cache/'research/appearance-resources-comparison.json')
    native = read(cache/'research/appearance-resources-native.json')
    if proof['mismatchCount'] or proof['counts']['projectionControls'] != len(native['cases']):
        raise ValueError('Matching completed resource projection comparison required')
    for report in [proof,native]:
        for path,digest in report['inputs'].items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('Resource selection evidence changed: '+path)
        for path,digest in report['sources'].items():
            source = root/path if report is proof else root/'tools'/path
            if sha(source.read_bytes()) != digest:
                raise ValueError('Resource selection source changed: '+str(source))
    baseline = next(c for c in native['cases'] if c['label'] == 'default-cache-key-control' and
                    c['input']['defaultEntry']['key']['name'] == 'Viego')
    copied = next(c for c in native['cases'] if c['event'] and c['event']['entityId'] == 1073741887 and
                  c['input']['entries'][-1]['key']['name'] == 'Gangplank')
    polymorph = next(c for c in native['cases'] if c['event'] and c['event']['entityId'] == 1073741887 and
                     c['input']['entries'][-1]['key']['name'] == 'LuluPolymorphCritter')
    bg,fg = '#101923','#bacbdc'
    fig = plt.figure(figsize=(16,9),facecolor=bg)
    fig.text(.055,.94,'Appearance and base spell resources select independently',color='white',fontsize=23,weight='bold')
    fig.text(.055,.895,'Original selector + original base-context callback | Native and WASM agree | Build 16.21.829.8620',color=fg,fontsize=12)
    for x,value,label in [(.055,proof['counts']['projectionControls'],'supplied-stack controls'),
                          (.37,proof['counts']['channelsCompared'],'resource channel comparisons'),
                          (.735,proof['counts']['baseContextCallbacks'],'original base-context callbacks')]:
        fig.text(x,.81,f'{value:,}',color='#78d5c2',fontsize=29,weight='bold')
        fig.text(x,.775,label,color=fg,fontsize=11)
    fig.text(.055,.685,'Input over supplied Viego / skin 43 baseline',color=fg,fontsize=11)
    fig.text(.40,.685,'Selected key: callback 0x10',color=fg,fontsize=11)
    fig.text(.72,.685,'Base spell resource context',color=fg,fontsize=11)
    for y,label,case in [(.58,'Default entry',baseline),(.445,'Recorded Gangplank push',copied),(.31,'Recorded polymorph push',polymorph)]:
        fig.text(.055,y,label,color='white',fontsize=14)
        for x,index in [(.40,2),(.72,5)]:
            key = case['projection']['keys'][index]
            label = key['name']+' / '+str(key['skinId'])
            if key['name'] == 'LuluPolymorphCritter':
                label = 'LuluPolymorphCritter / 0'
            rect = FancyBboxPatch((x-.012,y-.035),.265,.085,boxstyle='round,pad=0.008',
                                  transform=fig.transFigure,facecolor='#1d3443',edgecolor='#477187')
            fig.patches.append(rect)
            fig.text(x,y,label,color='#78d5c2',fontsize=13)
    fig.text(.055,.20,'Verified scope: explicit prepared cache, absent local player, empty alternate forms and modifier names.',color='#78d5c2',fontsize=12)
    fig.text(.055,.14,'Still required: accepted live stack transitions, cache readiness, remaining unit callbacks, poses and effect creation.',color='#efc38b',fontsize=12)
    fig.text(.055,.075,'Component diagnostic only. These are independent controls using recorded inputs; no additional replay spells are visible yet.',color=fg,fontsize=11)
    output = cache/'public/evidence/latest-appearance-resources.png'
    output.parent.mkdir(exist_ok=True,parents=True)
    fig.savefig(output,dpi=100,facecolor=bg)
    plt.close(fig)
    report = {'schema':1,'kind':'appearance-resource-selection-diagnostic','inputs':inputs,
              'rendererSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(output.read_bytes()),
              'scope':{'diagnosticOnly':True,'gameplayRendered':False,'mainViewerExpanded':False}}
    output.with_suffix('.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'sha256':report['imageSha256']}))


if __name__ == '__main__':
    main()
