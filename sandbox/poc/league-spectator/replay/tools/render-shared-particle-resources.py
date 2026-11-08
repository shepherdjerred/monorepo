"""Show verified native particle texture inputs; this is not effect playback."""
import argparse
import json
import math
from pathlib import Path
import textwrap
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image
from graphics_block_texture_device import decode_plane,digest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path)
    parser.add_argument('--champion-catalog',action='store_true')
    args=parser.parse_args()
    cache=args.cache.resolve();root=Path(__file__).resolve().parent
    path=cache/'research/shared-particle-preload-queue-native.json'
    encoded=path.read_bytes();report=json.loads(encoded)
    if report['kind']!='original-shared-particle-preload-observations' or not report['assetQueue']:
        raise ValueError('Expected original shared preloads with an owned asset queue')
    for file,expected in report['sources'].items():
        if digest((root/file).read_bytes())!=expected:raise ValueError('Resource producer changed: '+file)
    for file,expected in report['inputs'].items():
        if digest(Path(file).read_bytes())!=expected:raise ValueError('Resource input changed: '+file)
    catalog=None;catalog_raw=None;catalog_path=cache/'research/champion-catalog-comparison.json'
    if args.champion_catalog:
        catalog_raw=catalog_path.read_bytes();catalog=json.loads(catalog_raw)
        if (catalog['sourceSha256']!=digest((root/'compare-champion-catalog.py').read_bytes()) or
                catalog['build']!=report['build'] or not catalog['namesAndOrderMatchBin'] or
                not catalog['nameSetMatchesSkinInfo'] or not catalog['bothReferenceInputsFullyConsumed']):
            raise ValueError('Current successful independent catalog-name comparison required')
        for file,expected in catalog['inputs'].items():
            if digest(Path(file).read_bytes())!=expected:raise ValueError('Catalog comparison input changed: '+file)
        original=json.loads((cache/'research/champion-catalog-native.json').read_bytes())
        for file,expected in original['sources'].items():
            if digest((root/file).read_bytes())!=expected:raise ValueError('Catalog native producer changed: '+file)
        for file,expected in original['inputs'].items():
            if digest(Path(file).read_bytes())!=expected:raise ValueError('Catalog native input changed: '+file)
    textures=[row for row in report['textures'] if 'compression' in row]
    if not textures:raise ValueError('No decoded particle textures to display')
    images=[]
    for texture in textures:
        levels=[[bytes.fromhex(p) for p in level] for level in texture['levelsHex']]
        if digest(b''.join(p for level in levels for p in level))!=texture['nativeSourceSha256']:
            raise ValueError('Encoded texture digest differs')
        readbacks={(row['mip'],row['layer']):row for row in texture['readbacks']}
        if len(readbacks)!=len(levels)*texture['layers'] or not texture['gpuDecodedPixelsVerified']:
            raise ValueError('Every authored face and mip needs verified GPU readback')
        for mip,planes in enumerate(levels):
            w,h=max(1,texture['width']>>mip),max(1,texture['height']>>mip)
            for layer,data in enumerate(planes):
                rgba=decode_plane(texture['nativeFormat'],w,h,data)
                check=readbacks[(mip,layer)]
                if digest(data)!=check['encodedSha256'] or digest(rgba)!=check['sha256']:
                    raise ValueError('Texture pixels differ from GPU observation')
                if mip==0 and layer==0:images.append(Image.frombytes('RGBA',(w,h),rgba))
    rows=math.ceil(len(images)/4)
    bg,fg,muted,green,amber='#101923','#e3edf7','#9caec2','#78d5c2','#efc38b'
    if not 1<=len(report['cases'])<=12:raise ValueError('Diagnostic case list exceeds explicit display bounds')
    case_height=(len(report['cases'])-2)*.3
    height=6.2+rows*2.8+case_height
    fig=plt.figure(figsize=(15,height),facecolor=bg)
    def y(inches):return 1-inches/height
    fig.text(.045,y(.55),'Particle resource loading',color=fg,fontsize=25,weight='bold')
    fig.text(.045,y(.9),'Actual installed texture inputs | Build '+report['build']+' | Textures only; effects are not simulated',color=muted,fontsize=12)
    stats=[(len(report['assetQueueJobs']),'native queued reads executed'),
           (len(textures),'textures checked on the GPU'),
           (sum(s['compiled'] for s in report['shaders']),'game shaders compiled')]
    if catalog:stats.append((catalog['counts']['nativeEntries'],'catalog names matched'))
    for i,(value,label) in enumerate(stats):
        x=.045+i*.94/len(stats)
        fig.text(x,y(1.55),str(value),color=green,fontsize=32,weight='bold')
        fig.text(x,y(1.88),label,color=muted,fontsize=10)
    for i,case in enumerate(report['cases']):
        label=case['path'].rsplit('/',1)[-1]
        loaded=bool(case.get('resource'))
        status=('native returned no resource' if case['completed'] and not loaded else
                'preload returned; queued jobs retired' if case.get('queuedJobsRetired') else 'incomplete')
        fig.text(.045,y(2.35+i*.3),label+' — '+status,color=green if loaded and case.get('queuedJobsRetired') else amber,fontsize=11)
    top=3.25+case_height
    for i,(texture,image) in enumerate(zip(textures,images)):
        column,row=i%4,i//4
        axis=fig.add_axes([.045+column*.24,y(top+row*2.8+1.9),.21,1.9/height],facecolor='#243242')
        # Composite transparency over an explicit checkerboard, without
        # changing the decoded source or the GPU comparison above.
        w,h=image.size
        checker=Image.new('RGBA',(w,h))
        checker.putdata([(39,52,66,255) if (x//16+z//16)%2 else (23,34,46,255) for z in range(h) for x in range(w)])
        checker.alpha_composite(image)
        axis.imshow(checker,interpolation='nearest');axis.set_xticks([]);axis.set_yticks([])
        for spine in axis.spines.values():spine.set_color('#3a4b60')
        axis.set_title(f"Texture {i+1} · {texture['compression']}",color=fg,fontsize=11,pad=8)
        fig.text(.045+column*.24,y(top+row*2.8+2.17),f"{w} × {h} | {texture['mips']} authored mip levels",color=muted,fontsize=10)
        fig.text(.045+column*.24,y(top+row*2.8+2.42),'RGBA readback: exact match',color=green,fontsize=10)
    bottom=top+rows*2.8
    boundary=report['boundary']
    message=('Next boundary: '+boundary['message']) if boundary else 'All supplied preloads returned and all queued jobs retired.'
    fig.text(.045,y(bottom+.2),textwrap.fill(message,145),color=amber if boundary else green,fontsize=11)
    if catalog:
        fig.text(.045,y(bottom+.65),str(catalog['counts']['nativeEntries'])+' native metadata names match independent BIN and skin-info reads. Entries include game-mode variants.',color=green,fontsize=10)
    fig.text(.045,y(bottom+1.05),'Software BC decoding → RGBA8 upload. Native GPU BC rounding parity remains unverified.',color=muted,fontsize=10)
    fig.text(.045,y(bottom+1.4),'No additional replay spells enabled. World binding, emitter simulation and scene rendering remain unverified.',color=muted,fontsize=11)
    output=cache/'public/evidence/latest-particle-resources.png';output.parent.mkdir(parents=True,exist_ok=True)
    fig.savefig(output,dpi=100,facecolor=bg);plt.close(fig)
    evidence={'schema':1,'kind':'shared-particle-resource-diagnostic',
              'inputs':{str(path):digest(encoded)},'rendererSha256':digest(Path(__file__).read_bytes()),
              'imageSha256':digest(output.read_bytes()),'textureCount':len(textures),
              'scope':{'diagnosticOnly':True,'effectPlaybackRendered':False,'mainViewerExpanded':False}}
    if catalog:evidence['inputs'][str(catalog_path)]=digest(catalog_raw)
    output.with_suffix('.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'sha256':evidence['imageSha256']}))


if __name__=='__main__':main()
