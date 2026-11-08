"""Render shared script lookup and real GPU resource controls, not gameplay."""
import argparse
import json
from pathlib import Path
import struct
import textwrap
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('--actor',action='append',required=True)
    p.add_argument('--module-providers',action='store_true')
    p.add_argument('--effect-preload',action='store_true')
    args = p.parse_args()
    if args.effect_preload and not args.module_providers:p.error('--effect-preload requires --module-providers')
    cache,root = args.cache.resolve(),Path(__file__).resolve().parents[1]
    inputs = {}
    def checked(path):
        encoded = path.read_bytes()
        inputs[str(path)] = sha(encoded)
        report = json.loads(encoded)
        for name,digest in report['sources'].items():
            if sha((root/'tools'/name).read_bytes()) != digest:
                raise ValueError('Shared resource diagnostic producer changed: '+name)
        for name,digest in report['inputs'].items():
            if sha(Path(name).read_bytes()) != digest:
                raise ValueError('Shared resource diagnostic input changed: '+name)
        return report
    paths = checked(cache/'research/script-manifest-all-shared-paths-native.json')
    actors = [checked(cache/'research'/('character-unit-callbacks-'+actor.replace('/','-')+
               '-wad-script-preload-registry'+('-modules' if args.module_providers else '')+
               ('-effects' if args.effect_preload else '')+'-gpu-native.json')) for actor in args.actor]
    if (paths['boundary'] or not paths['scope']['allManifestFieldsCompared'] or
            not paths['allSharedNamesRequested'] or not actors or len(actors)>3):
        raise ValueError('Complete shared-name comparison and one to three controls required')
    probes,manifest = paths['sharedPathProbes'],paths['manifest']
    if any(row['found'] != row['archiveMembership'] for row in probes):
        raise ValueError('Native shared script paths disagree with archive membership')
    textures,buffers = 0,0
    for actor in actors:
        graphics = actor['nativeGraphics']
        if (actor['build'] != paths['build'] or not actor['scriptFileRegistry']['allSerializedFieldsCompared'] or
                not actor['spellPreloadManager']['originalConstructorCompleted'] or
                not graphics['initialization']['originalModelResourceConstructorCompleted'] or
                actor['scope']['acceptedMatchAppearanceVerified'] or actor['scope']['mainViewerExpanded']):
            raise ValueError('Expected matching explicit native controls outside accepted replay state')
        if len(graphics['textures']) != 10 or any(not row['gpuBytesVerified'] for row in graphics['textures']+graphics['buffers']):
            raise ValueError('Every supplied GPU resource needs verified readback')
        if args.module_providers and not actor['moduleProviders']['originalConstructorCompleted']:
            raise ValueError('Original module providers must have completed construction')
        if args.effect_preload:
            components = actor['effectPreloadComponents']
            if (not components['originalDataComponentsExecuted'] or components['completeManagerConstructorExecuted'] or
                    components['workerPoolExecuted'] or not components['existingResourceGroupsReused'] or
                    components['resourceReadinessVerified']):
                raise ValueError('Expected scoped effect data components preserving existing resource groups')
        textures += len(graphics['textures'])
        buffers += len(graphics['buffers'])
    found = sum(row['found'] for row in probes)
    bg,fg,muted,green,amber = '#101923','#e3edf7','#9caec2','#78d5c2','#efc38b'
    fig = plt.figure(figsize=(16,10),facecolor=bg)
    title = 'Shared script preloading reaches particle resources' if args.effect_preload else 'Shared script lookup and original resource loading'
    fig.text(.055,.94,title,color=fg,fontsize=25,weight='bold')
    fig.text(.055,.90,'Build '+paths['build']+' | Original CPU code + offscreen GLES | No League or browser process',color=muted,fontsize=12)
    for x,value,label in [(.055,found,'script paths found in the installed archive'),
                          (.43,len(probes),'native lookups: zero membership mismatches'),
                          (.80,textures,'verified default texture uploads')]:
        fig.text(x,.81,f'{value:,}',color=green,fontsize=32,weight='bold')
        fig.text(x,.77,label,color=muted,fontsize=10)
    fig.text(.055,.715,f"Manifest: {manifest['namespaceCount']:,} namespaces | "
             f"{manifest['namespaceScripts']+manifest['otherScriptNames']:,} names | "
             f"{manifest['lookupEntries']:,} packed entries. Every serialized field compared.",color=muted,fontsize=11)
    fig.text(.055,.675,'Lookup inventory includes items, summoner spells, game modes and TFT; it is not a gameplay coverage count.',color=muted,fontsize=11)
    fig.text(.055,.61,'Cold client',color=fg,fontsize=13,weight='bold')
    fig.text(.31,.61,'Preload calls entered / returned',color=muted,fontsize=10)
    fig.text(.59,.61,'Particle lookups' if args.effect_preload else 'Manifest / GPU setup',color=muted,fontsize=11)
    fig.text(.79,.61,'Full appearance call',color=muted,fontsize=11)
    for index,actor in enumerate(actors):
        y = .55-index*.065
        fig.text(.055,y,actor['actorKey'].split('/')[1].capitalize(),color=fg,fontsize=15,weight='bold')
        requests = actor['spellPreloadRequests']
        fig.text(.31,y,str(len(requests))+' / '+str(sum(row['completed'] for row in requests)),color=green,fontsize=15)
        fig.text(.59,y,str(len(actor['effectPreloadRequests'])) if args.effect_preload else 'Completed controls',color=green,fontsize=12)
        complete = actor['scope']['completeProjectionCall']
        fig.text(.79,y,'Returned normally' if complete else 'Incomplete',color=green if complete else amber,fontsize=12)
    if args.effect_preload:
        fig.text(.055,.365,'Particle requests are cache/loader observations. Returned handles do not prove emitter data or playback readiness.',color=muted,fontsize=10)
    fig.text(.055,.33,'Default GPU textures: first texel shown; all recorded subresources passed byte readback.',color=muted,fontsize=11)
    for index,record in enumerate(actors[0]['nativeGraphics']['textures']):
        raw = bytes.fromhex(record['levelsHex'][0][0])
        if record['nativeFormat'] == 2:
            color = tuple(value/255 for value in [raw[2],raw[1],raw[0],raw[3]])
            label = 'RGBA '+bytes([raw[2],raw[1],raw[0],raw[3]]).hex()
        elif record['nativeFormat'] == 0x15:
            value = struct.unpack('<f',raw[:4])[0]
            color = (min(1,max(0,value)),)*3+(1,)
            label = 'R32F '+format(value,'.3g')
        else:raise ValueError('Unsupported verified default texture format')
        x = .055+index*.089
        fig.add_artist(Rectangle((x,.245),.066,.045,transform=fig.transFigure,facecolor=color,edgecolor=muted,linewidth=1))
        fig.text(x,.22,label,color=muted,fontsize=7)
    boundaries = []
    for actor in actors:
        boundary = actor['boundary']
        if not boundary:continue
        if boundary['instructionRva'] == 0x1e833d and boundary['registers']['r14'] == 0x88:
            boundaries.append('Shared module/file-provider service is required (original read at 0x1e833d).')
        elif boundary['instructionRva'] == 0x6895e4 and boundary['registers']['rdi'] == 0:
            boundaries.append('Map-skin context is required for shared character preloads (original read at 0x6895e4).')
        else:boundaries.append(boundary['message'])
    boundaries = sorted(set(boundaries))
    message = 'Current runtime boundary: '+(' | '.join(boundaries) if boundaries else 'No appearance-call failure in these supplied controls.')
    fig.text(.055,.165,textwrap.fill(message,145)[:440],color=amber,fontsize=10,linespacing=1.5)
    fig.text(.055,.07,'Preparation diagnostic. Live world binding, complete assets and A/V matching remain unverified. No additional preview spells enabled.',color=muted,fontsize=10)
    output = cache/'public/evidence/latest-shared-resource-loading.png'
    fig.savefig(output,dpi=100,facecolor=bg)
    plt.close(fig)
    result = {'schema':1,'kind':'shared-resource-loading-diagnostic','inputs':inputs,
              'rendererSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(output.read_bytes()),
              'counts':{'sharedPathProbes':len(probes),'foundPaths':found,'missingPaths':len(probes)-found,
                        'verifiedTextureUploads':textures,'verifiedBuffers':buffers,
                        'preloadCallsEntered':sum(len(actor['spellPreloadRequests']) for actor in actors),
                        'preloadCallsReturned':sum(row['completed'] for actor in actors for row in actor['spellPreloadRequests']),
                        'particleLookupCalls':sum(len(actor['effectPreloadRequests']) for actor in actors)},
              'scope':{'diagnosticOnly':True,'gameplayRendered':False,'mainViewerExpanded':False}}
    output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'counts':result['counts'],'sha256':result['imageSha256']}),flush=True)


if __name__ == '__main__':
    main()
