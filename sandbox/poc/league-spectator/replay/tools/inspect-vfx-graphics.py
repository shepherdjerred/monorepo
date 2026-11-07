"""Check native GPU observations against retained assets, TOCs and code bytes.

This checks resource provenance and observed activation boundaries. It does not
turn a boundary into success or establish browser rendering or League fidelity.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct
from PIL import Image


def sha(data):return hashlib.sha256(data).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path)
    parser.add_argument('--pipelines',action='store_true')
    parser.add_argument('--meshes',action='store_true')
    parser.add_argument('--cubemaps',action='store_true')
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public'
    if args.cubemaps:args.meshes=True
    if args.meshes:args.pipelines=True
    mode='cubemaps' if args.cubemaps else 'meshes' if args.meshes else 'pipelines' if args.pipelines else 'graphics'
    source=cache/f"research/vfx-{mode}-native.json";raw=source.read_bytes();data=json.loads(raw)
    expected_kind=f'native-vfx-{mode}-observations' if args.meshes else 'native-vfx-pipeline-observations' if args.pipelines else 'native-vfx-graphics-observations'
    if (data['kind']!=expected_kind or data['build']!='16.21.829.8620' or
            data['protocol']!='20e09df23c66b85e'):
        raise ValueError('Unadmitted native graphics observation')
    for path,expected in data['inputs'].items():
        if sha(Path(path).read_bytes())!=expected:raise ValueError(f'Native graphics input changed: {path}')
    for name,expected in data['sources'].items():
        if sha(Path(__file__).with_name(name).read_bytes())!=expected:
            raise ValueError(f'Native graphics producer changed: {name}')
    image=(assets/'decoder-16.21-macos/image.bin').read_bytes()
    if sha(image)!=data['decoderImageSha256']:raise ValueError('Native graphics executable image changed')
    for block in data['originalBlocks']:
        at,size=block['rva'],block['size']
        if not 0<=at<at+size<=len(image) or sha(image[at:at+size])!=block['sha256']:
            raise ValueError('Native graphics original code observation changed')
    systems=json.loads((assets/'latest-vfx-system-assets/package.json').read_bytes())
    cases=data['cases']
    if len(cases)!=len(systems['systems']) or {c['effectId'] for c in cases}!=set(systems['systems']):
        raise ValueError('Native graphics observation omits or duplicates a prepared root')
    pairs_raw=(cache/'research/latest-shaders/pairs.json').read_bytes();pairs=json.loads(pairs_raw)
    package_raw=(assets/'latest-shaders/package.json').read_bytes();package=json.loads(package_raw)
    if pairs['shaderPackageSha256']!=sha(package_raw):raise ValueError('Prepared shader pair table differs')
    effects=json.loads((assets/'latest-effects/manifest.json').read_bytes())
    supplemental=json.loads((assets/'latest-native-textures/package.json').read_bytes())
    cube_package=None
    if args.cubemaps:
        from dds_cube import decode_cube
        cube_package=json.loads((assets/'latest-dds-cubes/package.json').read_bytes())
    catalog={name:(assets/'latest-effects',ref) for name,ref in effects['assets'].items()}
    for name,ref in supplemental['assets'].items():
        if name in catalog:raise ValueError('Supplement collides with frozen texture catalog')
        catalog[name]=(assets/'latest-native-textures',ref)
    checks=Counter();mutations=Counter()
    description=None;state_proofs={};uniform_proofs={};sampler_proofs={}
    if args.pipelines:
        from native_pipeline_description import NativePipelineDescription
        from graphics_pipeline_device import METAL_COMPARE_GL,METAL_STENCIL_GL,METAL_BLEND_GL,METAL_OPERATION_GL
        description=NativePipelineDescription(assets/'decoder-16.21-macos',cache/'research/LeagueofLegends-macos')
    for case in cases:
        if args.meshes:
            from inspect_mesh_resources import inspect_case
            inspect_case(case,catalog,checks)
        ref=systems['systems'][case['effectId']]
        if case['graphSha256']!=ref['sha256'] or not case['authoredRootPreserved']:
            raise ValueError('Native graphics root identity or authored prefix differs')
        defaults=case['defaultTextures']
        if len(defaults)!=10 or sum(len(t['readbacks']) for t in defaults)!=25:
            raise ValueError('Native graphics default resources did not all upload')
        textures=[*defaults,*case['preloadedTextures']]
        if len({t['glHandle'] for t in textures})!=len(textures):
            raise ValueError('Distinct native textures share a GPU handle')
        for texture in textures:
            header=bytes.fromhex(texture['headerHex'])
            if (len(header)!=17 or struct.unpack_from('<HH',header,8)!=(texture['width'],texture['height']) or
                    header[12]!=(texture['layers'] if texture['kind']=='array' else 1) or
                    header[13]!=texture['mips'] or header[14]!={'2d':0,'array':3,'cube':2}[texture['kind']] or
                    header[15]!=0 or header[16]!=texture['nativeFormat'] or not texture['gpuBytesVerified']):
                raise ValueError('Original native texture header differs from actual GPU upload')
            if 'levelsHex' in texture:
                native=[[bytes.fromhex(p) for p in level] for level in texture['levelsHex']]
                if sha(b''.join(p for level in native for p in level))!=texture['nativeSourceSha256']:
                    raise ValueError('Native default texture source bytes differ')
                canonical=[]
                for level in native:
                    planes=[]
                    for p in level:
                        if texture['nativeFormat']==2:
                            q=bytearray(p);q[0::4],q[2::4]=p[2::4],p[0::4];p=bytes(q)
                        elif texture['nativeFormat']!=21:raise ValueError('Unadmitted default format')
                        planes.append(p)
                    canonical.append(planes)
            else:
                root,asset=catalog[texture['path'].lower()]
                if texture['kind']=='cube':
                    if cube_package is None:raise ValueError('Prepared cube observation requires explicit inspection mode')
                    source=(root/asset['rawFile']).read_bytes()
                    if sha(source)!=asset['sourceSha256']:raise ValueError('Cube original DDS bytes differ')
                    cube=decode_cube(source);prepared=cube_package['cubes'][sha(source)]
                    canonical=[[p['rgba'] for p in level] for level in cube['levels']]
                    if texture['mips']!=cube['mips'] or texture['layers']!=6:
                        raise ValueError('Cube lost authored mip levels or faces')
                    for level in cube['levels']:
                        for plane in level:
                            record=prepared['levels'][plane['mip']][plane['face']]
                            pixels=(assets/'latest-dds-cubes'/record['file']).read_bytes()
                            if (pixels!=plane['rgba'] or sha(pixels)!=record['sha256'] or
                                    any(record[k]!=plane[k] for k in ['sourceOffset','sourceBytes','width','height','face','mip'])):
                                raise ValueError('Prepared cube plane does not match its original DDS face/mip')
                            checks['ddsCubePlanes']+=1
                    checks['ddsCubeRegistrations']+=1
                else:canonical=[[Image.open(root/asset['file']).convert('RGBA').tobytes()]]
                native=[]
                for level in canonical:
                    for rgba in level:
                        bgra=bytearray(rgba);bgra[0::4],bgra[2::4]=rgba[2::4],rgba[0::4];native.append(bytes(bgra))
                if sha(b''.join(native))!=texture['nativeSourceSha256']:
                    raise ValueError('Decoded prepared texture differs from native upload bytes')
            if len(texture['readbacks'])!=len(canonical)*texture['layers'] or len({(r['mip'],r['layer']) for r in texture['readbacks']})!=len(texture['readbacks']):
                raise ValueError('Texture GPU evidence omits or duplicates a face/mip')
            for readback in texture['readbacks']:
                pixels=canonical[readback['mip']][readback['layer']]
                if len(pixels)!=readback['bytes'] or sha(pixels)!=readback['sha256']:
                    raise ValueError('Observed GPU readback differs from retained source')
                checks['gpuSubresources']+=1
            checks['nativeTextureHeaders']+=1
        for request in case['shaderRequests']:
            stage=next(s for s in package['stages'] if s['file']==request['path'].lower() and s['stage']==request['stage'])
            declared={d['name']:d['value'] for d in stage['baseDefines']}
            kept=sorted((d['name'],d['value']) for d in request['defines'] if d['name'] in declared)
            candidates=[]
            for family in package['pairs']:
                if family[request['stage']]!=stage['file']:continue
                for pair in pairs['programs']:
                    if pair['family']!=family['name']:continue
                    subset=sorted((d['name'],d['value']) for d in pair['defines'] if d['name'] in declared)
                    if subset==kept:candidates.append(pair[request['stage']])
            if (not request['compiled'] or not candidates or
                    any(c['sha256']!=request['translation']['sha256'] for c in candidates)):
                raise ValueError('Native selected shader differs from independent prepared pair enumeration')
            checks['shaderSelections']+=1
        handles={s['glHandle']:s for s in case['shaderRequests']}
        for program in case['programs']:
            if (not program['linked'] or handles[program['vertex']]['stage']!='vertex' or
                    handles[program['pixel']]['stage']!='pixel'):
                raise ValueError('Native graphics program does not contain both compiled stages')
            checks['linkedPrograms']+=1
        for pipeline in case['pipelineRequests']:
            if len(bytes.fromhex(pipeline['descriptorHex']))!=32 or pipeline['glProgram'] not in {p['glHandle'] for p in case['programs']}:
                raise ValueError('Native pipeline request lacks an actual linked program')
            if not args.pipelines and (case['status']!='boundary' or case['error']!='Native render-pipeline state provider is not implemented'):
                raise ValueError('Unimplemented pipeline was reported as successful activation')
        if args.pipelines:
            for pipeline in case['pipelines']:
                header=bytes.fromhex(pipeline['nativeHeaderHex']);state=pipeline['state']
                if (len(header)!=48 or header[8:40].hex()!=pipeline['descriptorHex'] or
                        struct.unpack_from('<Q',header,40)[0]!=pipeline['nativeProgram'] or not pipeline['created'] or
                        pipeline['validation']['state']!=state):
                    raise ValueError('Native pipeline constructor or queried GPU state differs')
                key=pipeline['descriptorHex']
                if key not in state_proofs:
                    native=description.observe(bytes.fromhex(key));color,depth,raster=native['color'],native['depth'],native['raster']
                    expected={'depthFunction':METAL_COMPARE_GL[depth['setDepthCompareFunction:']],
                        'depthMask':bool(depth.get('setDepthWriteEnabled:',0)),
                        'colorMask':[bool(color['setWriteMask:']&bit) for bit in [8,4,2,1]],
                        'blendEnabled':bool(color['setBlendingEnabled:']),
                        'cullEnabled':bool(raster['cullMode']),
                        'frontFace':0x0900 if raster['winding']==0 else 0x0901,
                        'polygonOffset':[raster['biasSlope'],raster['biasConstant']]}
                    if expected['blendEnabled']:
                        expected['blendFactors']=[METAL_BLEND_GL[color[k]] for k in ['setSourceRGBBlendFactor:',
                            'setDestinationRGBBlendFactor:','setSourceAlphaBlendFactor:','setDestinationAlphaBlendFactor:']]
                        expected['blendOperations']=[METAL_OPERATION_GL[color[k]] for k in ['setRgbBlendOperation:','setAlphaBlendOperation:']]
                    front=depth.get('setFrontFaceStencil:');back=depth.get('setBackFaceStencil:')
                    expected['stencilEnabled']=front is not None
                    if front is not None:
                        if front!=back:raise ValueError('Native stencil faces differ')
                        expected.update(stencilFunction=METAL_COMPARE_GL[front['setStencilCompareFunction:']],
                            stencilOperations=[METAL_STENCIL_GL[front[k]] for k in ['setStencilFailureOperation:',
                                'setDepthFailureOperation:','setDepthStencilPassOperation:']],
                            stencilReadMask=front['setReadMask:'],stencilWriteMask=front['setWriteMask:'])
                    if any(state[k]!=value for k,value in expected.items()):
                        raise ValueError(f'GLES state differs from original native descriptor setters: {expected} / {state}')
                    state_proofs[key]={'native':native,'glesCompared':expected}
                elif any(state[k]!=value for k,value in state_proofs[key]['glesCompared'].items()):
                    raise ValueError('Identical native pipeline descriptors produce differing GLES states')
                checks['nativePipelineDescriptions']+=1
            requests={m['bindingPointer']:m for m in case['materialBindingRequests'] if 'bindingPointer' in m}
            programs={p['glHandle']:p for p in case['programs']}
            for material in case['materialBindings']:
                request=requests[material['nativePointer']];header=bytes.fromhex(material['nativeHeaderHex'])
                if len(header)!=34 or any(header[8:]) or not material['created'] or material['sceneInputsBound']:
                    raise ValueError('Native material binding base or scene-input scope differs')
                for buffer in material['uniformBuffers']:
                    program=programs[material['glProgram']];shader=handles[program[buffer['stage']]]
                    translation=json.loads((assets/'latest-shaders'/shader['translation']['file']).read_bytes())
                    block=next(b for b in translation['sidecar']['blocks'] if b['glslName']==buffer['name'])
                    signature=sha(json.dumps({'uniforms':request['uniforms'],'block':block},sort_keys=True).encode())
                    if signature not in uniform_proofs:
                        native=description.uniform_bytes(request['uniforms'],block)
                        uniform_proofs[signature]={'bytesHex':native.hex(),'sha256':sha(native)}
                    expected=uniform_proofs[signature]
                    if (buffer['bytesHex']!=expected['bytesHex'] or buffer['gpuReadbackSha256']!=expected['sha256'] or
                            not buffer['gpuBytesVerified']):
                        raise ValueError('Material constant GPU bytes differ from original zero-fill/vector copy')
                    checks['nativeUniformBufferCopies']+=1
                for texture in material['textures']:
                    sampler=texture['sampler']
                    if sampler['parameters']!=sampler['queriedParameters']:
                        raise ValueError('Material sampler queried state differs')
                    key=sampler['descriptorHex']
                    if key not in sampler_proofs:
                        native=description.sampler_description(bytes.fromhex(key));fields=native['fields']
                        modes={0:0x812f,2:0x2901,3:0x8370}
                        expected={str(token):modes[fields[name]] for token,name in [
                            (0x2802,'setSAddressMode:'),(0x2803,'setTAddressMode:'),(0x8072,'setRAddressMode:')]}
                        min_filter=[[0x2600,0x2601],[0x2700,0x2701],[0x2702,0x2703]][fields['setMipFilter:']][fields['setMinFilter:']]
                        expected.update({str(0x2801):min_filter,
                            str(0x2800):[0x2600,0x2601][fields['setMagFilter:']]})
                        if sampler['parameters']!=expected:raise ValueError('GLES sampler differs from original descriptor setters')
                        sampler_proofs[key]={'native':native,'glesCompared':expected}
                    elif sampler['parameters']!=sampler_proofs[key]['glesCompared']:
                        raise ValueError('Identical native samplers produce differing GPU state')
                    source_texture=next(t for t in request['textures'] if t['nativeTexture']==texture['nativeTexture'])
                    if source_texture['glTexture']!=texture['glTexture']:raise ValueError('Material GPU texture identity differs')
                    if args.cubemaps:
                        supplied=next(t for t in textures if t['pointer']==texture['nativeTexture'])
                        expected={'2d':('texture2d',0x0de1),'cube':('cube',0x8513)}[supplied['kind']]
                        if (texture['dimension'],texture['textureTarget'])!=expected or texture['queriedGlTexture']!=supplied['glHandle']:
                            raise ValueError('Material dimension/queried target differs from supplied texture')
                        if supplied['kind']=='cube':checks['cubeMaterialBindings']+=1
                    checks['materialSamplerBindings']+=1
            if case['status']=='activated':
                for actor in case['actors']:
                    if len(bytes.fromhex(actor['bytesHex']))!=actor['allocationBytes']:
                        raise ValueError('Native actor snapshot is incomplete')
                    checks['createdActorSnapshots']+=1
        graph=json.loads((assets/'latest-vfx-system-assets'/ref['file']).read_bytes())
        heap=bytearray.fromhex(graph['heapHex']);before=bytes(heap)
        for write in case['assetHeapWrites']:
            offset,size=write['offset'],write['size']
            if size>8 or bytes(heap[offset:offset+size]).hex()!=write['beforeHex']:
                raise ValueError('Native asset heap write exceeds retained observation')
            heap[offset:offset+size]=write['value'].to_bytes(size,'little',signed=False)
            mutations[f"0x{write['instructionRva']:x}"]+=1
        changed=[i for i,(a,b) in enumerate(zip(before,heap)) if a!=b]
        if changed!=case['authoredHeapDifferences']:raise ValueError('Native loaded-asset mutations are not explained by observed writes')
        if case['status']=='activated':
            if not case['parent'] or len(bytes.fromhex(case['parentHex']))!=0x2c0:
                raise ValueError('Activated native parent snapshot is absent')
            checks['activatedParents']+=1
        checks['completeRoots']+=1
        if args.pipelines and checks['completeRoots']%64==0:
            print(json.dumps({'completed':checks['completeRoots'],'total':len(cases),
                'uniqueNativeStates':len(state_proofs),'uniqueNativeUniformCopies':len(uniform_proofs)}),flush=True)
    contract_proof=None
    if args.pipelines:
        import inspect
        description_sources={Path(inspect.getfile(c)).name:sha(Path(inspect.getfile(c)).read_bytes())
            for c in NativePipelineDescription.__mro__ if c is not object}
        contract_proof={'schema':1,'kind':'original-native-pipeline-contracts','observationSha256':sha(raw),
            'sources':description_sources,'originalBlocks':list(description.blocks.values()),
            'pipelineDescriptors':state_proofs,'uniformCopies':uniform_proofs,'samplerDescriptors':sampler_proofs,
            'counts':{'uniquePipelineDescriptors':len(state_proofs),'uniqueUniformCopies':len(uniform_proofs),
                'uniqueSamplerDescriptors':len(sampler_proofs)},
            'scope':{'originalDescriptorSettersExecuted':True,'dataOnlyDescriptorApiPort':True,
                'metalResourceCreated':False,'originalZeroFillAndParameterCopyExecuted':True}}
        contract_path=cache/f"research/vfx-{'cubemaps-pipeline' if args.cubemaps else 'meshes-pipeline' if args.meshes else 'pipeline'}-contracts.json"
        contract_path.write_text(json.dumps(contract_proof,indent=2),encoding='utf-8')
    result={'schema':1,'kind':f'native-vfx-{mode}-inspection' if args.meshes else 'native-vfx-pipeline-inspection' if args.pipelines else 'native-vfx-graphics-inspection','observationSha256':sha(raw),
        'inspectorSha256':sha(Path(__file__).read_bytes()),'pairTableSha256':sha(pairs_raw),
        'checks':dict(checks),'nativeAssetMutationInstructions':dict(mutations),
        'scope':data['scope'],'mismatchCount':0}
    if contract_proof:result['nativeContractsSha256']=sha(contract_path.read_bytes())
    if args.meshes:result['meshInspectorSha256']=sha(Path(__file__).with_name('inspect_mesh_resources.py').read_bytes())
    if args.cubemaps:result['cubeDecoderSha256']=sha(Path(__file__).with_name('dds_cube.py').read_bytes())
    destination=cache/f"research/vfx-{mode}-inspection.json"
    destination.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result))


if __name__=='__main__':main()
