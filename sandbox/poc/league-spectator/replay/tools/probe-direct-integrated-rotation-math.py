"""Original typed flat-curve postload, sampling and rotation arithmetic controls."""
import argparse
import inspect
import json
from pathlib import Path
import struct

from unicorn import x86_const as r
from vfx_postload_native import NativeVfxPostload
from vfx_asset_native import OBJECT
from vfx_spawn_native import name_hash, sha, ADDRESSES as A


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}
    def raw(path):
        data = path.read_bytes()
        key = str(path.resolve())
        if key in inputs and inputs[key] != sha(data): raise ValueError('Input drift')
        inputs[key] = sha(data)
        return data
    def read(path): return json.loads(raw(path))
    assets = cache / 'public'
    manifest_bytes = raw(assets / 'latest-effects/manifest.json')
    manifest = json.loads(manifest_bytes)
    inv_bytes = raw(assets / 'decoder-16.21-macos/vfx-assets.json')
    inv = json.loads(inv_bytes)
    n = NativeVfxPostload(assets / 'decoder-16.21-macos', args.client)
    if sha(inv_bytes) != n.profile['vfxAssetsSha256'] or inv['effectsManifestSha256'] != sha(manifest_bytes):
        raise ValueError('Exact profile-pinned inventory and manifest required')
    effect_id, index = 'champions/ornn/0/bfa38a4a', 4
    ref = manifest['definitions'][effect_id]
    encoded = raw(assets / 'latest-effects' / ref['file'])
    if sha(encoded) != ref['sha256']: raise ValueError('Exact source definition required')
    source = json.loads(encoded)['definition']['complexEmitterDefinitionData'][index]
    meta = inv['emitters'][f'{effect_id}:{index}']
    if meta['definitionSha256'] != ref['sha256']: raise ValueError('Emitter identity differs')
    blob = raw(cache / 'research/latest-effects/bins' / f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
    if sha(blob) != meta['rawSourceSha256']: raise ValueError('Raw source differs')
    fields = []
    rotation_hash = name_hash('rotation0')
    for field in meta['fields']:
        data = blob[field['offset']:field['offset'] + field['bytes']]
        if sha(data) != field['sha256']: raise ValueError('Original field span differs')
        fields.append((field['hash'], data))
    rotation = [data for identity, data in fields if identity == rotation_hash]
    if len(rotation) != 1 or rotation[0][-24:] != struct.pack('<6f', 0, 4, 0, 0, 4, 0):
        raise ValueError('Typed two-vector numeric control span differs')
    cases = []
    fractions = [-.25, 0, 1/120, 1/63, .1, .25, 1/3, .5, .75, .99, 1, 1.25]
    for rate in [[0,4,0], [1,-2,.5], [-5,0,2], [0,0,0], [120,-45,17]]:
        supplied = [data[:-24] + struct.pack('<6f', *(rate * 2)) if identity == rotation_hash else data for identity, data in fields]
        before = n.load(supplied)
        after = n.postload()
        if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
            raise ValueError('Original typed flat rotation load unresolved')
        value = OBJECT + 0x438
        curve = n.q(value + 0x10)
        if n.u32(curve + 0x4c) != 64 or n.u.mem_read(curve + 0x40, 1)[0] != 1:
            raise ValueError('Original integrated postload sample count/type differs')
        table = n.q(curve + 0x60)
        if not n.baseline_heap <= table < table + 64*12 <= n.next_heap:
            raise ValueError('Original integral table ownership differs')
        sample = n.allocate(16)
        target = n.q(n.q(curve) + 0x40)
        if target != n.base + 0x16d9fa0: raise ValueError('Original vector sample virtual differs')
        queries = []
        for fraction in fractions:
            n.call(target - n.base, {r.UC_X86_REG_RDI:curve,r.UC_X86_REG_RSI:value,r.UC_X86_REG_RDX:sample,r.UC_X86_REG_RCX:0,
                                    r.UC_X86_REG_XMM0:int.from_bytes(struct.pack('<f',fraction),'little')})
            result = bytes(n.u.mem_read(sample,12))
            queries.append({'fraction':struct.unpack('<f',struct.pack('<f',fraction))[0], 'sampleHex':result.hex()})
        arithmetic = []
        # Exact original contiguous arithmetic fragment; its caller's sampled
        # integral, preexisting birth angles and lifetime are explicitly supplied.
        frame = A['stack'] - 0x1000
        for lifetime in [.3, 1, 2.5]:
            for query in queries:
                n.u.mem_write(frame - 0x88, bytes.fromhex(query['sampleHex']))
                n.u.mem_write(frame - 0x48, bytes(8))
                n.u.reg_write(r.UC_X86_REG_RBP, frame)
                n.u.reg_write(r.UC_X86_REG_XMM1, int.from_bytes(struct.pack('<4f',90,17,0,0),'little'))
                n.u.reg_write(r.UC_X86_REG_XMM4, int.from_bytes(struct.pack('<4f',-45,0,0,0),'little'))
                n.u.reg_write(r.UC_X86_REG_XMM2, int.from_bytes(struct.pack('<4f',lifetime,0,0,0),'little'))
                n.u.emu_start(n.base + 0x175e32f,n.base + 0x175e361,count=100)
                xy = int(n.u.reg_read(r.UC_X86_REG_XMM1)).to_bytes(16,'little')[:8]
                z = int(n.u.reg_read(r.UC_X86_REG_XMM4)).to_bytes(16,'little')[:4]
                arithmetic.append({'fraction':query['fraction'],'sampleHex':query['sampleHex'],
                                   'lifetime':struct.unpack('<f',struct.pack('<f',lifetime))[0],
                                   'rotation':[90,17,-45],'resultHex':(xy+z).hex()})
        cases.append({'rate':rate,'samplesHex':bytes(n.u.mem_read(table,64*12)).hex(),'queries':queries,'arithmetic':arithmetic})
        n.restore_preload_arena()
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    out = {'schema':1,'kind':'original-flat-integrated-vector3-rotation-controls',
           'build':manifest['build'],'protocol':manifest['protocol'],'decoderImageSha256':n.profile['decoderImageSha256'],
           'sourceDefinition':{'effectId':effect_id,'emitterIndex':index,'rotation0':source['rotation0']},
           'cases':cases,'inputs':inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(paths)},
           'originalBlocks':list(n.blocks.values()),
           'scope':{'originalTypedReaderPostloadAndCurveSampler':True,'originalContiguousArithmeticFragment':True,
                    'numericControlsReplaceOnlyTwoSerializedVectors':True,'fullParticleControllerExecuted':False,
                    'runtimeAdmissionChanged':False,'gpuSubmitted':False,'matchCoverage':False}}
    path = cache / 'research/direct-integrated-rotation-math-native.json'
    path.write_text(json.dumps(out,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(path),'cases':len(cases),'tableScalars':len(cases)*192,
                      'queries':sum(len(c['queries']) for c in cases),'arithmetic':sum(len(c['arithmetic']) for c in cases)}))


if __name__ == '__main__': main()
