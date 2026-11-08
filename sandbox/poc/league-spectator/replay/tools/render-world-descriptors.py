"""Offscreen geometry from the compared complete descriptor factory fixtures.

This is a component gallery with supplied detached descriptors and scene inputs,
not expanded replay coverage, a browser capture or a League reference frame.
"""
import importlib.util
import json
from pathlib import Path
import struct
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('world_descriptor_draw', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
cache, angle = [Path(v).resolve() for v in sys.argv[1:3]]
assets, root, inputs = cache/'public', Path(__file__).parent.parent, {}


def raw(path):
    b = path.read_bytes()
    inputs[str(path.resolve())] = adapter.sha(b)
    return b


def read(path):
    return json.loads(raw(path))


native_path = cache/'research/world-descriptors-native.json'
proof_path = cache/'research/world-descriptors-comparison.json'
native, proof = read(native_path), read(proof_path)
if (native['counts']['returningRoots'] != 10 or proof['counts']['roots'] != 10 or
        proof['mismatchCount'] or proof['scope']['partialActorSelection'] or
        not proof['scope']['completeOriginalDescriptorFactory'] or
        not proof['scope']['explicitDetachedDescriptors'] or proof['scope']['decodedReplayRequestsExecuted']):
    raise ValueError('Complete supplied descriptor factory comparison is required')
for report, directory in [(native, root/'tools'), (proof, root)]:
    for name, digest in report['sources'].items():
        if adapter.sha(raw(directory/name)) != digest:
            raise ValueError('Descriptor producer changed: '+name)
    for path, digest in report['inputs'].items():
        if adapter.sha(raw(Path(path))) != digest:
            raise ValueError('Descriptor input changed: '+path)
# Consume the same immutable material artifacts as the verified THREE renderer.
# Their embedded producer sources describe preparation history; current runtime
# admission uses exact package pins, shader bytes and texture bytes instead.
flow = read(cache/'research/parent-viewer.json')
if flow['mismatchCount'] or not flow['scope']['actualThreeLoadPrepareCommit']:
    raise ValueError('Current shared renderer flow comparison is required')
for name, digest in flow['sources'].items():
    if adapter.sha(raw(root/name)) != digest:
        raise ValueError('Shared renderer source changed: '+name)
packages = []
texture_path = assets/'latest-parent-textures/package.json'
expected = [digest for p,digest in flow['inputs'].items() if Path(p).resolve() == texture_path]
if len(expected) != 1 or adapter.sha(raw(texture_path)) != expected[0]:
    raise ValueError('Verified shared renderer texture/material contract differs')
texture_contract = read(texture_path)
for name in ['latest-complete-quad-gpu/package.json', 'latest-trail-particles/gpu.json']:
    path = assets/name
    if adapter.sha(raw(path)) != texture_contract['packages'][name]:
        raise ValueError('Shared renderer material artifact differs: '+name)
    packages.append(read(path))
bindings = {(e['effectId'], e['emitterIndex']): e for package in packages for e in package['emitters']}
effects = read(assets/'latest-effects/manifest.json')
gpu_reference = read(cache/'research/parent-frames-native.json')
renderer = adapter.Draw(angle)
if renderer.info != gpu_reference['context']:
    raise ValueError('Descriptor offscreen graphics context differs')
for name, digest in gpu_reference['libraries'].items():
    if adapter.sha(raw(angle/name)) != digest:
        raise ValueError('Descriptor graphics library changed')
programs, textures, panels, draws = {}, {}, [], []
clear = renderer.gl.glClear
try:
    for case in native['cases']:
        effect_id, frame = case['effectId'], case['frames'][11]
        points = np.asarray([struct.unpack_from('<3f', bytes.fromhex(g['verticesHex']), i)
            for g in frame['geometry'] for i in range(0, len(bytes.fromhex(g['verticesHex'])), 28)])
        if not len(points):
            raise ValueError('Supplied descriptor selected frame has no geometry')
        lo, hi = points.min(0), points.max(0)
        center, extent = (lo+hi)/2, max(hi[0]-lo[0], hi[2]-lo[2])*.6
        if not np.isfinite(extent) or extent <= 0:
            raise ValueError('Supplied descriptor geometry has no fitted top-view extent')
        projection = [1/extent,0,0,-center[0]/extent,0,0,1/extent,-center[2]/extent,0,0,0,.5,0,0,0,1]
        renderer.gl.glClearColor(.025,.035,.055,1)
        clear(0x4000)
        renderer.gl.glClear = lambda mask: None
        active, rgba = 0, None
        for g in sorted(frame['geometry'], key=lambda g: bindings[(effect_id,g['emitterIndex'])]['suppliedSortPass']):
            if not g['indicesHex']:
                continue
            binding = bindings[(effect_id,g['emitterIndex'])]
            if binding['sourceDefinitionSha256'] != effects['definitions'][effect_id]['sha256']:
                raise ValueError('Descriptor geometry/material identity differs')
            key = tuple(binding['shaders'][s]['sha256'] for s in ['vertex','pixel'])
            if key not in programs:
                stages = []
                for stage in ['vertex','pixel']:
                    ref = binding['shaders'][stage]
                    b = raw(assets/'latest-shaders'/ref['file'])
                    if adapter.sha(b) != ref['sha256']:
                        raise ValueError('Descriptor game shader changed')
                    stages.append(json.loads(b))
                programs[key] = renderer.program(*stages), stages
            program, stages = programs[key]
            values, bound = {}, {}
            for shader in stages:
                for block in shader['sidecar']['blocks']:
                    b = bytes.fromhex(next(v for v in binding['blocks'] if v['glslName'] == block['glslName'])['bytesHex'])
                    for member in block['members']:
                        if not member['used']:
                            continue
                        if member['name'] == 'mProj':
                            value = projection
                        elif member['name'] == 'vCamera':
                            value = native['camera']['position']
                        else:
                            code = {'float':'f','uint':'I','int':'i','bool':'I'}[member['scalar']]
                            value = list(struct.unpack_from('<'+code*(member['size']//4), b, member['offset']))
                        values[block['glslName']+'.'+member['name']] = value
                for texture in shader['sidecar']['textures']:
                    choices = [binding['textures'][s['glslName']] for s in texture['samplers']]
                    if not choices or any(v != choices[0] for v in choices):
                        raise ValueError('Ambiguous descriptor material texture')
                    t, texture_key = choices[0], json.dumps(choices[0],sort_keys=True)
                    if texture_key not in textures:
                        if t['kind'] == 'prepared-texture':
                            path = assets/'latest-effects'/t['file']
                            if adapter.sha(raw(path)) != t['sha256']:
                                raise ValueError('Descriptor game texture changed')
                            pixels = np.array(Image.open(path).convert('RGBA'))
                            address, filtering = t['sampler']['name'], 'nearest' if t['sampler']['pixelated'] else 'linear'
                        elif t['kind'] in ['supplied-white-lookup','supplied-transparent-remap']:
                            pixels = np.full((1,1,4),255 if t['kind'] == 'supplied-white-lookup' else 0,dtype=np.uint8)
                            address, filtering = 'clamp', 'nearest'
                        else:
                            raise ValueError('Descriptor material texture input is unprovided')
                        textures[texture_key] = renderer.texture(pixels,address,filtering)
                    bound[texture['name']] = textures[texture_key]
            factors, mapping = binding['nativeBlendFactors'], {1:1,6:0x302,7:0x303}
            if factors[0] != factors[1] or factors[2] != factors[3]:
                raise ValueError('Separate descriptor diagnostic blending is unimplemented')
            rgba, _buffers = renderer.draw(program,stages,bytes.fromhex(g['verticesHex']),bytes.fromhex(g['indicesHex']),
                values,bound,blend=(mapping[factors[0]],mapping[factors[2]]))
            draws.append({'effectId':effect_id,'emitterIndex':g['emitterIndex'],
                'verticesSha256':adapter.sha(bytes.fromhex(g['verticesHex'])),
                'indicesSha256':adapter.sha(bytes.fromhex(g['indicesHex'])), 'shaderHashes':list(key)})
            active += 1
        renderer.gl.glClear = clear
        if rgba is None:
            raise ValueError('Descriptor diagnostic emitted no draw')
        linear = rgba[:,:,:3].astype(np.float64)/255
        display = np.clip(np.where(linear<=.0031308,linear*12.92,1.055*linear**(1/2.4)-.055),0,1)
        name = read(assets/'latest-effects'/effects['definitions'][effect_id]['file'])['definition']['particleName']
        panels.append({'effectId':effect_id,'name':name,'tick':frame['tick'],'supplied':case['supplied'],
            'activeLayers':active,'display':display,'projection':projection,'rgbaSha256':adapter.sha(rgba.tobytes())})
finally:
    renderer.gl.glClear = clear
    for program,_ in programs.values():
        renderer.gl.glDeleteProgram(program)
    renderer.close()
fig, axes = plt.subplots(2,5,figsize=(18,9),facecolor='#101822')
for ax,panel in zip(axes.flat,panels):
    ax.imshow(panel['display'])
    ax.axis('off')
    name = panel['name'] if len(panel['name']) <= 33 else panel['name'][:30]+'…'
    supplied = panel['supplied']
    ax.set_title(f'{supplied["name"]} · scale {supplied["scale"]} · rate {supplied["rate"]}\n{name}',color='#e9eef7',fontsize=9)
fig.suptitle('Original complete effect factory → activation → shared particle runtime',color='#e9eef7',fontsize=18,y=.98)
fig.text(.5,.925,'Ten prepared roots · supplied detached descriptors · native/WASM state and geometry agree',ha='center',color='#a9bacf',fontsize=12)
fig.text(.5,.055,'Component gallery, not replay playback: resources, position, seed, clock, material inputs and fitted cameras are supplied.',ha='center',color='#d8bd8b',fontsize=10)
fig.text(.5,.025,'Live unit stacks and attachments are unresolved. Browser appearance, League parity and real-time performance are unverified.',ha='center',color='#d8bd8b',fontsize=10)
fig.subplots_adjust(top=.86,bottom=.11,left=.025,right=.985,hspace=.3,wspace=.09)
output = assets/'evidence/latest-world-descriptors.png'
fig.savefig(output,dpi=110,facecolor=fig.get_facecolor())
plt.close(fig)
result = {'schema':1,'kind':'supplied-world-descriptor-factory-offscreen-gallery','build':native['build'],
    'nativeObservationSha256':inputs[str(native_path)],'comparisonSha256':inputs[str(proof_path)],
    'inputs':inputs,'rendererSha256':adapter.sha(Path(__file__).read_bytes()),'imageSha256':adapter.sha(output.read_bytes()),
    'context':renderer.info,'draws':draws,'panels':[{k:v for k,v in p.items() if k!='display'} for p in panels],
    'counts':{'panels':len(panels),'draws':len(draws),'programs':len(programs)},
    'scope':{'completeOriginalDescriptorFactory':True,'explicitDetachedDescriptors':True,
        'nativeGeometryComparedWithWasm':True,'translatedGameShaders':True,'suppliedMaterialInputsAndCamera':True,
        'sRgbDisplayEncoding':True,'matchReplayFrame':False,'decodedReplayRequestsExecuted':False,
        'browserExecuted':False,'referenceCompared':False,'realTimePerformanceEstablished':False}}
output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({'image':str(output),'sha256':result['imageSha256'],'counts':result['counts']}))
