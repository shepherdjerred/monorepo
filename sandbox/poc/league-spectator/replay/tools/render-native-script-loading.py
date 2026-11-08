"""Render verified native archive/script dependency observations, not gameplay."""
import argparse
import json
from pathlib import Path
import textwrap
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
    def checked(path):
        encoded = path.read_bytes()
        inputs[str(path)] = sha(encoded)
        report = json.loads(encoded)
        for name,digest in report['sources'].items():
            if sha((root/'tools'/name).read_bytes()) != digest:
                raise ValueError('Native script diagnostic producer changed: '+name)
        for name,digest in report['inputs'].items():
            if sha(Path(name).read_bytes()) != digest:
                raise ValueError('Native script diagnostic input changed: '+name)
        return report
    archive = checked(cache/'research/native-wad-files.json')
    payloads = checked(cache/'research/native-wad-payloads.json')
    actors = [checked(cache/'research'/('character-unit-callbacks-'+actor.replace('/','-')+'-wad-script-native.json'))
              for actor in args.actor]
    if (archive['boundary'] or not archive['scope']['archiveLoaded'] or payloads['boundary'] or
            not payloads['scope']['nativeDecompressionCompared'] or not actors):
        raise ValueError('Completed original archive and payload comparisons required')
    for actor in actors:
        if (actor['build'] != archive['build'] or not actor['installedScripts']['originalSignatureValidationCompleted'] or
                actor['installedScripts']['indexSha256'] != archive['indexSha256'] or
                not actor['scriptVm']['originalConstructorCompleted'] or actor['scope']['mainViewerExpanded']):
            raise ValueError('Matching scoped archive and script VM controls required')
    probes = archive['fileExistenceProbes']
    if any(case['actual'] != case['expected'] for case in probes):
        raise ValueError('Archive membership comparison failed')
    native_payloads = sum(case['originalDecompressionExecuted'] for case in payloads['cases'])
    bg,fg,muted,green,amber = '#101923','#e3edf7','#9caec2','#78d5c2','#efc38b'
    fig = plt.figure(figsize=(16,9),facecolor=bg)
    fig.text(.055,.93,'Original archive and character-script loading',color=fg,fontsize=25,weight='bold')
    fig.text(.055,.88,'Build '+archive['build']+' | Offline native controls | League is not running',color=muted,fontsize=12)
    for x,value,label in [(.055,archive['archive']['entries'],'archive entries: original signature accepted'),
                          (.43,len(probes),'native file lookups: independent agreement'),
                          (.78,native_payloads,'native Zstandard payloads: exact bytes')]:
        fig.text(x,.78,f'{value:,}',color=green,fontsize=32,weight='bold')
        fig.text(x,.735,label,color=muted,fontsize=10)
    fig.text(.055,.65,'Cold client control',color=fg,fontsize=13,weight='bold')
    fig.text(.33,.65,'Script found',color=muted,fontsize=11)
    fig.text(.50,.65,'Payload read',color=muted,fontsize=11)
    fig.text(.69,.65,'Lua VM',color=muted,fontsize=11)
    fig.text(.82,.65,'Full transition',color=muted,fontsize=11)
    states = []
    for index,actor in enumerate(actors):
        if index >= 3:raise ValueError('Diagnostic layout supports at most three controls')
        y = .57-index*.085
        found = any(row['exists'] and row['path'].lower().endswith('.luabin64') for row in actor['fileLookups'])
        character = actor['actorKey'].split('/')[1]
        payload_case = next(case for case in payloads['cases']
                            if case['path'] == 'data/characters/'+character+'/charscript'+character+'.luabin64')
        compressed_size = payload_case['compressedBytes']
        payload_read = any(row['name'] == '_fread' and row['requested'] == compressed_size and
                           row['read'] == compressed_size for row in actor['fileCalls'])
        complete = actor['scope']['completeProjectionCall']
        states.append({'actor':actor['actorKey'],'scriptFound':found,'compressedPayloadRead':payload_read,
                       'completeAppearanceTransition':complete})
        fig.text(.055,y,actor['actorKey'].split('/')[1].capitalize(),color=fg,fontsize=15,weight='bold')
        for x,yes in [(.33,found),(.50,payload_read),(.69,actor['scriptVm']['originalConstructorCompleted']),(.82,complete)]:
            fig.text(x,y,'Yes' if yes else 'Incomplete',color=green if yes else amber,fontsize=13)
    boundaries = []
    for actor in actors:
        boundary = actor['boundary']
        if not boundary:continue
        dependency = actor['scriptDependencyState']['spellPreloadManager']
        if (boundary['instructionRva'] == 0x84ba0a and dependency == {'globalRva':0x2472910,'pointer':0} and
                boundary['registers']['r15'] == 8):
            boundaries.append('Spell preload manager has not been constructed in the cold client.')
        else:boundaries.append(boundary['message'])
    boundaries = sorted(set(boundaries))
    message = 'Next boundary: '+(' | '.join(boundaries) if boundaries else 'No appearance-call failure in these supplied controls.')
    fig.text(.055,.28,textwrap.fill(message,145),color=amber,fontsize=12,linespacing=1.6)
    fig.text(.055,.17,'World bindings, complete asset readiness and graphics initialization remain separate requirements.',color=muted,fontsize=12)
    fig.text(.055,.09,'Diagnostic only. No additional replay spells enabled. Component checks do not measure A/V fidelity.',color=muted,fontsize=11)
    output = cache/'public/evidence/latest-native-script-loading.png'
    fig.savefig(output,dpi=100,facecolor=bg)
    plt.close(fig)
    result = {'schema':1,'kind':'native-script-loading-diagnostic','inputs':inputs,
              'rendererSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(output.read_bytes()),
              'counts':{'validatedIndexEntries':archive['archive']['entries'],'membershipComparisons':len(probes),
                        'nativePayloadComparisons':native_payloads},'actors':states,
              'scope':{'diagnosticOnly':True,'gameplayRendered':False,'mainViewerExpanded':False}}
    output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'counts':result['counts'],'sha256':result['imageSha256']}),flush=True)


if __name__ == '__main__':
    main()
