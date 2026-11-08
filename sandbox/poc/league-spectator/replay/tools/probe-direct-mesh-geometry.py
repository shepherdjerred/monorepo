"""Bounded original static-mesh emitter/primitive inspection and controls."""
import argparse
import inspect
import json
import struct
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from unicorn import x86_const as r
from vfx_postload_native import NativeVfxPostload
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_spawn_native import sha, ADDRESSES as A


class NativeMeshGeometry(NativeLoadedQuad):
    def prepare_mesh(self, state, header):
        if state['pendingLinkFixups'] or state['mathCalls']:
            raise ValueError('Unchanged postload required')
        obj, heap = bytes.fromhex(state['objectHex']), bytes.fromhex(state['heapHex'])
        start = state['heapStart']; end = start + len(heap)
        if len(obj) != 0x470 or not 0x10400000 <= start <= end < 0x12000000:
            raise ValueError('Typed emitter ownership differs')
        primitive = struct.unpack_from('<Q', obj, 0x60)[0]
        graph = self.prepare_quad({'__type': 'VfxEmitterDefinitionData',
                                  'SpawnShape': {'__type': 'VfxShapeLegacy'},
                                  'primitive': {'__type': 'VfxPrimitiveArbitraryQuad'}})
        self.u.mem_write(A['definition'], obj)
        self.u.mem_write(0x10400000, bytes(end - 0x10400000))
        self.u.mem_write(start, heap)
        if self.q(primitive) != self.base + 0x23f6a80 or self.u.mem_read(primitive + 8, 1)[0] != 3:
            raise ValueError('Original static-mesh primitive required')
        if obj[0x2d1] & 8 or struct.unpack_from('<Q', obj, 0x3c8)[0]:
            raise ValueError('Terrain/child provider not admitted by this observer')
        self.next_heap = end
        mesh = self.allocate(len(header))
        self.u.mem_write(mesh, header)
        self.put(A['link'] + 0x28, 'Q', mesh)
        graph.update(allocations=list(self.allocations.items()), nextHeap=self.next_heap, segments=[
            {'address': A['definition'], 'bytesHex': bytes(self.u.mem_read(A['definition'], 0x10000)).hex()},
            {'address': start, 'bytesHex': bytes(self.u.mem_read(start, self.next_heap - start)).hex()}])
        self.mesh_pointer = mesh
        return graph

    def render_quad(self, view):
        wrapper, output = 0x1003c000, 0x1003c100
        self.put(wrapper, 'Q', A['actor'])
        count = struct.unpack('<I', self.u.mem_read(self.q(A['actor'] + 0xa0) + 0x10, 4))[0]
        matrices = []
        before = self.snapshot()
        for index in range(count):
            self.u.mem_write(output, bytes([0xa5]) * 96)
            self.call(0x173c0b0, {r.UC_X86_REG_RDI: wrapper, r.UC_X86_REG_RSI: index,
                                 r.UC_X86_REG_RDX: 0, r.UC_X86_REG_RCX: 0,
                                 r.UC_X86_REG_R8: 0, r.UC_X86_REG_R9: output + 16})
            if self.u.reg_read(r.UC_X86_REG_RAX) & 0xff != 1:
                raise ValueError('Static mesh transform not resolved')
            if bytes(self.u.mem_read(output, 16)) != bytes([0xa5])*16 or bytes(self.u.mem_read(output+80,16)) != bytes([0xa5])*16:
                raise ValueError('Native matrix output guard changed')
            matrices.append(bytes(self.u.mem_read(output+16,64)).hex())
        if before != self.snapshot(): raise ValueError('Mesh transform mutated particle/RNG state')
        return {'matrixHex': matrices, 'sourceParticleCount': count,
                'systemScale': list(struct.unpack('<2f', self.u.mem_read(A['system']+0x150,8)))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args(); cache = args.cache.resolve(); assets = cache / 'public'
    inputs = {}
    def raw(path):
        data = path.read_bytes(); inputs[str(path.resolve())] = sha(data); return data
    def read(path): return json.loads(raw(path))
    profile = read(assets / 'decoder-16.21-macos/profile.json')
    image = raw(assets / 'decoder-16.21-macos/image.bin')
    if sha(image) != profile['decoderImageSha256']: raise ValueError('Original image differs')
    manifest = read(assets / 'latest-effects/manifest.json')
    inventory = read(assets / 'decoder-16.21-macos/vfx-assets.json')
    if inputs[str((assets / 'decoder-16.21-macos/vfx-assets.json').resolve())] != profile['vfxAssetsSha256']:
        raise ValueError('Pinned typed field inventory required')
    identity, index = 'champions/hecarim/0/e57b8289', 15
    ref = manifest['definitions'][identity]
    record = read(assets / 'latest-effects' / ref['file'])
    if inputs[str((assets / 'latest-effects' / ref['file']).resolve())] != ref['sha256']:
        raise ValueError('Pinned authored definition required')
    meta = inventory['emitters'][f'{identity}:{index}']
    blob = raw(cache / 'research/latest-effects/bins' / f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
    if sha(blob) != meta['rawSourceSha256']: raise ValueError('Original source differs')
    fields = [blob[x['offset']:x['offset'] + x['bytes']] for x in meta['fields']]
    if any(sha(value) != field['sha256'] for value, field in zip(fields, meta['fields'])):
        raise ValueError('Original field bytes differ')
    loader = NativeVfxPostload(assets / 'decoder-16.21-macos', args.client)
    before = loader.load(fields); state = loader.postload()
    if before['ignored'] or before['mismatched']: raise ValueError('Unchanged emitter required')
    obj = bytes.fromhex(state['objectHex'])
    primitive = struct.unpack_from('<Q', obj, 0x60)[0]
    vtable = loader.q(primitive)
    targets = [loader.q(vtable + offset) - loader.base for offset in range(0, 0x90, 8)]
    disassembler = Cs(CS_ARCH_X86, CS_MODE_64)
    result = {'schema': 1, 'kind': 'original-static-mesh-primitive-inspection',
              'effectId': identity, 'emitterIndex': index,
              'authoredEmitter': record['definition']['complexEmitterDefinitionData'][index],
              'primitivePointer': primitive, 'vtableRva': vtable - loader.base,
              'targets': targets,
              'primitiveHex': bytes(loader.u.mem_read(primitive, 0x80)).hex(),
              'writerDisassembly': [{'rva': ins.address, 'mnemonic': ins.mnemonic, 'op': ins.op_str}
                                    for ins in disassembler.disasm(image[targets[5]:targets[5]+0xc00], targets[5])],
              'inputs': inputs, 'state': state,
              'scope': {'unchangedTypedPostload': True, 'geometryExecuted': False,
                        'nativeAcceptance': None, 'browserRendering': False}}
    output = cache / 'research/direct-mesh-geometry-inspection.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    resource_observation = read(cache / 'research/vfx-meshes-native.json')
    resource_inspection = read(cache / 'research/vfx-meshes-inspection.json')
    if resource_inspection['observationSha256'] != inputs[str((cache/'research/vfx-meshes-native.json').resolve())] or resource_inspection['mismatchCount']:
        raise ValueError('Independent original SCB resource inspection required')
    resource_case = next(c for c in resource_observation['cases'] if c['effectId'] == identity)
    mesh_path = record['definition']['complexEmitterDefinitionData'][index]['primitive']['mMesh']['mSimpleMeshName'].lower()
    resource = next(m for m in resource_case['staticMeshSetups'] if m['path'] == mesh_path)
    header = bytes.fromhex(resource['headerAfterHex'])
    mesh_ref = manifest['assets'][mesh_path]
    mesh_raw = raw(assets / 'latest-effects' / mesh_ref['rawFile'])
    if sha(mesh_raw) != mesh_ref['sourceSha256']: raise ValueError('SCB source changed')
    vertex_record = next(b for b in resource_case['meshBuffers'] if b['nativePointer'] == resource['nativeBuffer'])
    vertex_bytes = bytes.fromhex(vertex_record['bytesHex'])
    if sha(vertex_bytes) != vertex_record['gpuReadbackSha256'] or len(vertex_bytes) != resource['triangles']*108:
        raise ValueError('Original native vertex bytes differ')
    native = NativeMeshGeometry(assets / 'decoder-16.21-macos', args.client)
    graph = native.prepare_mesh(state, header)
    bases = [
        ('identity', [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
        ('yaw90', [0,0,-1,0, 0,1,0,0, 1,0,0,0, 0,0,0,1]),
        ('pitch90', [1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1]),
        ('shear', [1,.2,-.3,0, .1,1,.4,0, .3,-.2,1,0, 0,0,0,1]),
    ]
    cases = []
    for seed in [1, 0x12345]:
        for pose, basis in bases:
            native.reset_quad(graph, seed, 0); previous=[23,-11,81]; frames=[]
            for tick in range(31):
                time=tick/60; current=[23+time*130,-11+time*3,81+time*70]
                value={'time':time,'previous':previous,'current':current,'basis':basis,'viewPosition':[300,900,1200]}
                frames.append({'input':value,'output':native.frame_quad(value)});previous=current
            cases.append({'effectId':identity,'emitterIndex':index,'seedHex':f'{seed:016x}','pose':pose,'frames':frames})
    leaf=[]
    mesh=loader.allocate(len(header)); loader.u.mem_write(mesh,header)
    matrix,position,scale,out=[loader.allocate(size) for size in [64,12,12,96]]
    for pose,basis in bases:
        for p in [[0,0,0],[23,-11,81]]:
            for s in [[6,6,6],[2,3,4],[-1,.5,2]]:
                loader.put(matrix,'16f',*basis);loader.put(position,'3f',*p);loader.put(scale,'3f',*s)
                loader.u.mem_write(out,bytes([0xa5])*96)
                loader.call(0x180a0a0,{r.UC_X86_REG_RDI:mesh,r.UC_X86_REG_RSI:matrix,r.UC_X86_REG_RDX:position,r.UC_X86_REG_RCX:scale,r.UC_X86_REG_R8:out+16})
                if bytes(loader.u.mem_read(out,16))!=bytes([0xa5])*16 or bytes(loader.u.mem_read(out+80,16))!=bytes([0xa5])*16:
                    raise ValueError('Leaf output guard changed')
                leaf.append({'pose':pose,'rotationMatrix':basis,'position':p,'scale':s,'matrixHex':bytes(loader.u.mem_read(out+16,64)).hex()})
    source_paths={Path(__file__),*[Path(inspect.getfile(c)) for c in type(native).__mro__ if c is not object],*[Path(inspect.getfile(c)) for c in type(loader).__mro__ if c is not object]}
    for path in source_paths:raw(path)
    blocks={x['rva']:x for x in [*loader.blocks.values(),*native.blocks.values()]}
    final={'schema':1,'kind':'original-static-mesh-particle-transform-controls','build':profile['clientVersion'],'protocol':profile['protocolDigest'],'decoderImageSha256':profile['decoderImageSha256'],
           'effectId':identity,'emitterIndex':index,'primitiveVtableRva':vtable-loader.base,
           'mesh':{'path':mesh_path,'sourceSha256':mesh_ref['sourceSha256'],'triangles':resource['triangles'],'vertexStride':36,'vertexBytesHex':vertex_bytes.hex(),'vertexBytesSha256':sha(vertex_bytes),'resourceHeaderHex':header.hex()},
           'leafControls':leaf,'cases':cases,'originalBlocks':list(blocks.values()),'inputs':inputs,
           'scope':{'unchangedTypedEmitter':True,'originalParticleBirthUpdateAndTransform':True,'copiedObservedOriginalStaticMeshResource':True,'suppliedClockPoseAndSeed':True,'defaultUnboundMaterialUv':True,'gpuDrawSubmitted':False,'instance208ByteBufferTranslated':False,'nativeWorldAcceptance':None,'browserRendering':False}}
    for path,expected in inputs.items():
        if sha(Path(path).read_bytes())!=expected:raise ValueError('Final source/input drift')
    output=cache/'research/direct-mesh-geometry-native.json';output.write_text(json.dumps(final,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'frames':sum(len(c['frames']) for c in cases),'leafControls':len(leaf),'meshVertices':len(vertex_bytes)//36}))


if __name__ == '__main__': main()
