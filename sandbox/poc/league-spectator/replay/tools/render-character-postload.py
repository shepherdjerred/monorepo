"""Render scoped native asset post-load and unit-resource observations."""
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
    p.add_argument('--actor',action='append',required=True)
    args = p.parse_args()
    cache,root = args.cache.resolve(),Path(__file__).resolve().parents[1]
    inputs = {}
    def read(path):
        encoded = path.read_bytes()
        inputs[str(path)] = sha(encoded)
        return json.loads(encoded)
    def checked(path):
        report = read(path)
        for source,digest in report['sources'].items():
            if sha((root/'tools'/source).read_bytes()) != digest:
                raise ValueError('Post-load diagnostic producer changed: '+source)
        for source,digest in report['inputs'].items():
            if sha(Path(source).read_bytes()) != digest:
                raise ValueError('Post-load diagnostic input changed: '+source)
        return report
    actors = []
    for actor in args.actor:
        stem = actor.replace('/','-')
        selected = checked(cache/'research'/('character-asset-postload-'+stem+'-types-23ea1915-45cd899f-9b67e9f6-ef3a0f33-f5fb07c7-native.json'))
        whole = checked(cache/'research'/('character-asset-postload-'+stem+'-native.json'))
        client = checked(cache/'research'/('ai-client-constructor-'+stem+'-native.json'))
        callbacks = checked(cache/'research'/('character-unit-callbacks-'+stem+'-native.json'))
        if (not selected['scope']['completeSuppliedStage'] or selected['scope']['allGraphRootsPostloaded'] or
                whole['scope']['completeSuppliedStage'] or not whole['resourceBoundary'] or not client['completed'] or
                callbacks['scope']['completeProjectionCall'] or not callbacks['boundary'] or
                callbacks['scope']['acceptedMatchAppearanceVerified']):
            raise ValueError('Expected explicit completed controls and unresolved full-state boundaries')
        actors.append((actor,selected,whole,client,callbacks))
    postloaded = sum(value[1]['counts']['completedRoots'] for value in actors)
    visits = sum(value[1]['counts']['objectVisits'] for value in actors)
    lookups = sum(value[4]['counts']['originalUnitResolverLookups'] for value in actors)
    bg,fg,muted,green,amber = '#101923','#e3edf7','#9caec2','#78d5c2','#efc38b'
    fig = plt.figure(figsize=(16,9),facecolor=bg)
    fig.text(.055,.93,'Original CPU asset post-load and unit resource routing',color=fg,fontsize=24,weight='bold')
    fig.text(.055,.88,'Build '+actors[0][1]['build']+' | Supplied cold-client controls | Native code executed without launching League',color=muted,fontsize=12)
    for x,value,label in [(.055,postloaded,'selected character / skin / VFX / resolver / animation roots'),
                          (.47,visits,'recursive object visits'),(.77,lookups,'original unit resource lookups')]:
        fig.text(x,.78,f'{value:,}',color=green,fontsize=30,weight='bold')
        fig.text(x,.735,label,color=muted,fontsize=10)
    fig.text(.055,.65,'Selected asset control',color=fg,fontsize=13,weight='bold')
    fig.text(.42,.65,'Post-loaded roots',color=muted,fontsize=11)
    fig.text(.65,.65,'Unit key lookups',color=muted,fontsize=11)
    fig.text(.82,.65,'Client constructor',color=muted,fontsize=11)
    for index,(actor,selected,whole,client,callbacks) in enumerate(actors):
        y = .57-index*.085
        fig.text(.055,y,actor.split('/')[1].capitalize(),color=fg,fontsize=15,weight='bold')
        fig.text(.42,y,str(selected['counts']['completedRoots']),color=green,fontsize=16)
        fig.text(.65,y,str(callbacks['counts']['originalUnitResolverLookups']),color=green,fontsize=16)
        fig.text(.82,y,'Completed',color=green,fontsize=13)
    fig.text(.055,.275,'Full-library boundary: default texture resources require completed graphics initialization.',color=amber,fontsize=12)
    fig.text(.055,.225,'Appearance transition boundary: character-script file lookup. Full transition and live world routing remain unverified.',color=amber,fontsize=12)
    fig.text(.055,.15,'Resource queries inspect the binding installed before the later callback failure. They do not complete or resume that transition.',color=muted,fontsize=11)
    fig.text(.055,.08,'Diagnostic only. No additional preview spells enabled. These counts are component evidence and do not measure A/V fidelity.',color=muted,fontsize=11)
    output = cache/'public/evidence/latest-character-postload.png'
    fig.savefig(output,dpi=100,facecolor=bg)
    plt.close(fig)
    result = {'schema':1,'kind':'character-postload-diagnostic','inputs':inputs,
              'rendererSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(output.read_bytes()),
              'counts':{'selectedPostloadedRoots':postloaded,'objectVisits':visits,'originalUnitResolverLookups':lookups},
              'scope':{'diagnosticOnly':True,'gameplayRendered':False,'mainViewerExpanded':False}}
    output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'counts':result['counts'],'sha256':result['imageSha256']}))


if __name__ == '__main__':
    main()
