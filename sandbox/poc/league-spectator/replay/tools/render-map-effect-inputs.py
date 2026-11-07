"""Render verified map and particle-input controls, not gameplay effects."""
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
    p.add_argument('--startup-variant',action='store_true')
    p.add_argument('--graphics-registries',action='store_true')
    p.add_argument('--preload-resources',action='store_true')
    args = p.parse_args()
    cache,root = args.cache.resolve(),Path(__file__).resolve().parents[1]
    inputs = {}
    def checked(name):
        path = cache/'research'/name
        encoded = path.read_bytes()
        inputs[str(path)] = sha(encoded)
        report = json.loads(encoded)
        for file,digest in report['sources'].items():
            if sha((root/'tools'/file).read_bytes()) != digest:
                raise ValueError('Map/particle diagnostic producer changed: '+file)
        for file,digest in report['inputs'].items():
            if sha(Path(file).read_bytes()) != digest:
                raise ValueError('Map/particle diagnostic input changed: '+file)
        return report
    map_ = checked('map-asset-links-native.json')
    legacy = checked('legacy-effect-inputs-native.json')
    startup = checked('startup-map-skin-native.json') if args.startup_variant else None
    graphics = checked('shared-graphics-registries-native.json') if args.graphics_registries else None
    preload = checked('shared-particle-preload-native.json') if args.preload_resources else None
    if (any(map_[key] != legacy[key] for key in ['build','protocol','decoderImageSha256']) or
            map_['boundaries'] or not map_['scope']['referenceLinksFixed'] or
            not map_['mapSkinContext']['originalConstructorCompleted'] or
            map_['scope']['assetReadinessVerified'] or legacy['scope']['particlesSpawned']):
        raise ValueError('Expected matching completed map and explicitly scoped particle controls')
    if startup and (startup['boundary'] or not startup['scope']['recordedMapBootstrapArgumentsRecovered'] or
                    startup['decoderImageSha256'] != map_['decoderImageSha256'] or
                    startup['recovered']['mapId'] != map_['mapId'] or
                    startup['recovered']['variant'] != map_['mapSkinContext']['suppliedVariant']):
        raise ValueError('Recorded map-skin arguments must match the constructor control')
    if graphics and (graphics['decoderImageSha256'] != map_['decoderImageSha256'] or
                     any(not row['compiled'] for row in graphics['shaderRequests']) or
                     any(not row['linked'] for row in graphics['programs'])):
        raise ValueError('Matching successful shader compilation and program linking required')
    if preload and (preload['decoderImageSha256'] != map_['decoderImageSha256'] or
                    any(not row['gpuBytesVerified'] for row in preload['buffers']) or preload['scope']['particlesSpawned']):
        raise ValueError('Matching verified GPU mesh buffers outside particle playback required')
    bg,fg,muted,green,amber = '#101923','#e3edf7','#9caec2','#78d5c2','#efc38b'
    fig = plt.figure(figsize=(15,11),facecolor=bg)
    fig.text(.055,.94,'Map context and real particle file loading',color=fg,fontsize=24,weight='bold')
    fig.text(.055,.905,'Native preparation diagnostic | Build '+map_['build']+' | No League or browser process',color=muted,fontsize=12)
    for x,value,label in [(.055,map_['counts']['loadedRoots'],'typed map dependency assets read'),
                          (.39,map_['counts']['fixedReferences'],'references resolved and compared'),
                          (.76,len(map_['mapRoot']['skins']),'installed map-skin objects')]:
        fig.text(x,.83,f'{value:,}',color=green,fontsize=33,weight='bold')
        fig.text(x,.79,label,color=muted,fontsize=11)
    fig.text(.055,.725,'Original map-skin constructor: completed; selected/default pointers and allocation guard checked.',color=green,fontsize=12)
    variant = ('Recorded startup: '+startup['recovered']['mode']+', map '+str(startup['recovered']['mapId'])+', skin '+
               startup['recovered']['variant']+'. Matches the constructor control; full world state remains unverified.') if startup else (
               'Supplied variant: '+map_['mapSkinContext']['suppliedVariant']+'. Replay variant and full asset readiness remain unverified.')
    fig.text(.055,.687,variant,color=muted if startup else amber,fontsize=10)
    fig.text(.055,.62,'Original legacy particle-definition reader',color=fg,fontsize=15,weight='bold')
    fig.text(.055,.585,'Input',color=muted,fontsize=11)
    fig.text(.52,.585,'File opened',color=muted,fontsize=11)
    fig.text(.68,.585,'Loader returned',color=muted,fontsize=11)
    fig.text(.84,.585,'Raw vector counts',color=muted,fontsize=11)
    for i,case in enumerate(legacy['cases']):
        y = .54-i*.055
        opened = any(row['opened'] for row in case.get('fileReads',[]))
        complete = case['completed']
        counts = ', '.join(str(row['count']) for row in case['runtimeVectors']) if complete else 'Unverified'
        name = case['path'].rsplit('/',1)[-1]
        fig.text(.055,y,name,color=fg,fontsize=10)
        fig.text(.52,y,'Yes' if opened else 'No',color=green if opened else amber,fontsize=11)
        fig.text(.68,y,str(case['originalReturn']) if complete else 'Incomplete',color=green if complete else amber,fontsize=11)
        fig.text(.84,y,counts,color=green if complete and opened else amber,fontsize=11)
    if legacy['boundary']:
        message = 'Current particle parser boundary: '+legacy['boundary']['message']
    else:
        message = 'Missing-file control: normal return with no file; default data remains. A successful return alone is insufficient.'
    fig.text(.055,.36,textwrap.fill(message,130),color=amber,fontsize=11,linespacing=1.5)
    if graphics:
        done = sum(row['completed'] for row in graphics['partialRegistries'])
        fig.text(.055,.275,'Shared graphics construction',color=fg,fontsize=15,weight='bold')
        fig.text(.055,.235,f"{done}/{len(graphics['partialRegistries'])} registry constructors completed | "
                 f"{len(graphics['shaderRequests'])} shaders compiled | {len(graphics['programs'])} program linked",color=green,fontsize=12)
        message = graphics['boundary']['message'] if graphics['boundary'] else (
            f"{len(graphics['pipelines'])} pipeline state bundle applied/queried in GLES; "
            f"{len(graphics['bindings'])} material binding constructed. Replay activation remains unverified.")
        fig.text(.055,.195,textwrap.fill(message,130),color=amber,fontsize=11)
    if preload:
        buffers = [row for row in preload['buffers'] if row['bytes'] > 4]
        layouts = preload['layouts']
        message = f"Shared preload reached {sum(row['bytes'] for row in buffers):,} bytes of mesh buffers and {len(layouts)} vertex layout."
        if preload['boundary']:
            boundary = preload['boundary']
            if boundary['instructionAddress']-0x100000000 == 0x1477032 and boundary['registers']['rdi'] == 0:
                message += ' Next missing service: texture work queue.'
            else:message += ' Boundary: '+boundary['message']
        fig.text(.055,.145,textwrap.fill(message,145),color=amber,fontsize=10)
    fig.text(.055,.075,'Vector offsets: +0x10, +0x20, +0x30, +0x40. Counts are not verified emitter semantics. '
             +str(map_['counts']['originalSkippedFields'])+' native field skips remain explicit.',color=muted,fontsize=10)
    fig.text(.055,.025,'No additional replay spells enabled. World binding, particle simulation, rendering and A/V fidelity remain unverified.',color=muted,fontsize=11)
    output = cache/'public/evidence/latest-map-effect-inputs.png'
    output.parent.mkdir(parents=True,exist_ok=True)
    fig.savefig(output,dpi=100,facecolor=bg)
    plt.close(fig)
    result = {'schema':1,'kind':'map-particle-input-diagnostic','inputs':inputs,
              'rendererSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(output.read_bytes()),
              'scope':{'diagnosticOnly':True,'gameplayRendered':False,'mainViewerExpanded':False}}
    output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'sha256':result['imageSha256']}))


if __name__ == '__main__':
    main()
