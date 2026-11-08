"""Paired complete authored single-emitter clocks before/after original rewrite.

Only the exact original single-lifetime resource fragment is executed; texture
acquisition and the remainder of resource postload are explicitly not claimed.
The derived definition field is copied before the original actor constructor.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_retirement_native import NativeVfxRetirement
from vfx_spawn_native import ADDRESSES as A, sha
from vfx_spawn_native import name_hash
from vfx_postload_native import NativeVfxPostload


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path); p.add_argument('client', type=Path)
    args = p.parse_args(); cache = args.cache.resolve(); decoder = cache / 'public/decoder-16.21-macos'
    inputs = {}
    def raw(path):
        data = path.read_bytes(); inputs[str(path.resolve())] = sha(data); return data
    def read(path):
        return json.loads(raw(path))
    sources = {str(Path(__file__).resolve()): sha(Path(__file__).read_bytes())}
    for cls in [*NativeVfxRetirement.__mro__, *NativeVfxPostload.__mro__]:
        if cls is not object:
            path = Path(inspect.getfile(cls)); sources[str(path.resolve())] = sha(path.read_bytes())
    for name in ['profile.json', 'image.bin', 'vfx-system.json', 'vfx-bound-quads.json', 'vfx-camera-quads.json', 'vfx-assets.json']:
        raw(decoder / name)
    n = NativeVfxRetirement(decoder, args.client)
    bound = n.checked_json('vfx-bound-quads.json', 'vfxBoundQuadsSha256')
    system = n.checked_json('vfx-system.json', 'vfxSystemSha256')
    meta = n.checked_json('vfx-camera-quads.json', 'vfxCameraQuadsSha256')
    manifest = read(cache / 'public/latest-effects/manifest.json')
    selected = [v for v in meta['templates'] if v['effectId'] == 'champions/akshan/20/0dc63b54' and v['emitterIndex'] == 9]
    if len(selected) != 1: raise ValueError('Exact single clock source required')
    ref = selected[0]; graph_raw = raw(decoder / ref['file'])
    if sha(graph_raw) != ref['sha256']: raise ValueError('Original graph changed')
    source = raw(cache / 'public/latest-effects' / manifest['definitions'][ref['effectId']]['file'])
    if sha(source) != ref['sourceDefinitionSha256']: raise ValueError('Authored definition changed')
    graph = json.loads(graph_raw)
    n.reset_parent(graph, 1, 0, bound, system)
    if n.q(A['definition'] + 0x100) or struct.unpack('<I', n.u.mem_read(A['definition'] + 0x28, 4))[0]:
        raise ValueError('Constant maximum and empty overrides required')
    original_definition = bytes(n.u.mem_read(A['definition'], 0x470))
    n.fragment(0x16e17e6, 0x16e1860, {r.UC_X86_REG_RAX: A['definition'], r.UC_X86_REG_R15: A['link']})
    rewritten_definition = bytes(n.u.mem_read(A['definition'], 0x470))
    changed = [i for i, pair in enumerate(zip(original_definition, rewritten_definition)) if pair[0] != pair[1]]
    if not changed or any(not 0x108 <= i < 0x10c for i in changed):
        raise ValueError('Original single rewrite changed unrelated definition bytes')
    modified = json.loads(graph_raw)
    for segment in modified['segments']:
        if segment['address'] <= A['definition'] + 0x108 < segment['address'] + len(bytes.fromhex(segment['bytesHex'])):
            data = bytearray.fromhex(segment['bytesHex']); offset = A['definition'] + 0x108 - segment['address']
            data[offset:offset + 4] = rewritten_definition[0x108:0x10c]; segment['bytesHex'] = data.hex()
            break
    else: raise ValueError('Owned derived graph definition segment absent')
    cases = []
    for seed in [1, 0x12345]:
        for variant, prepared in [('unclamped-control', graph), ('original-single-clock-rewrite', modified)]:
            n.reset_parent(graph, seed, 0, bound, system)
            pre_rewrite_timers = bytes(n.u.mem_read(A['link'] + 0x90, 8))
            if variant == 'original-single-clock-rewrite':
                n.fragment(0x16e17e6, 0x16e1860, {r.UC_X86_REG_RAX: A['definition'], r.UC_X86_REG_R15: A['link']})
            # Discard the owned prelude's empty actor; the final constructor
            # executes only after original timers and optional clock rewrite.
            rng = bytes(n.u.mem_read(A['stream'] + 8, 12))
            n.call(0x1756780, {r.UC_X86_REG_RDI: A['actor'], r.UC_X86_REG_RSI: A['system'], r.UC_X86_REG_RDX: A['link']}, 0x1756a26)
            if bytes(n.u.mem_read(A['stream'] + 8, 12)) != rng or bytes(n.u.mem_read(A['link'] + 0x90, 8)) != pre_rewrite_timers:
                raise ValueError('Final actor constructor changed RNG or pre-rewrite timers')
            frames = []; previous = [0, 0, 0]
            initial_actor = bytes(n.u.mem_read(A['actor'], 0x128)).hex()
            for tick in range(61):
                time = tick / 60
                value = {'time': time, 'previous': previous, 'current': [time * 130, time * 3, time * 70],
                    'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                    'viewPosition': [0, 0, 1000], 'cameraRight': [1, 0, 0], 'cameraUp': [0, 1, 0],
                    'viewAxis': [0, 0, 1], 'multTexturePresent': False}
                output = n.frame_bound(value); frames.append({'input': value, 'output': output, 'linkTimersHex': bytes(n.u.mem_read(A['link'] + 0x90, 8)).hex()}); previous = value['current']
            cases.append({'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'], 'seedHex': f'{seed:016x}',
                'scenario': 'authored-default-lifetime', 'variant': variant, 'preRewriteLinkTimersHex': pre_rewrite_timers.hex(), 'initialActorHex': initial_actor, 'frames': frames})
    # Nontrivial clock control: retain the complete original three-key authored
    # birthRotation curve, but provide MAX lifetime and a non-tick-aligned delay
    # through the original typed field reader. First birth now has nonzero
    # emitter age; its sampled curve must use the rewritten lifetime.
    identity, index = 'champions/jinx/2/3b1dfaaf', 2
    inventory = read(decoder / 'vfx-assets.json')
    if inputs[str((decoder / 'vfx-assets.json').resolve())] != n.profile['vfxAssetsSha256'] or inventory['effectsManifestSha256'] != inputs[str((cache / 'public/latest-effects/manifest.json').resolve())]:
        raise ValueError('Exact original serialized field inventory required')
    entry = inventory['emitters'][f'{identity}:{index}']
    source_raw = raw(cache / 'public/latest-effects' / manifest['definitions'][identity]['file'])
    if sha(source_raw) != entry['definitionSha256'] or sha(source_raw) != manifest['definitions'][identity]['sha256']:
        raise ValueError('Original delayed-curve source changed')
    source_fields = json.loads(source_raw)['definition']['complexEmitterDefinitionData'][index]
    if len(source_fields['birthRotation0']['dynamics']['times']) != 3:
        raise ValueError('Original nonconstant birth curve required')
    blob = raw(cache / 'research/latest-effects/bins' / f"{entry['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
    if sha(blob) != entry['rawSourceSha256']: raise ValueError('Original delayed-curve BIN changed')
    fields = []
    for field in entry['fields']:
        encoded = blob[field['offset']:field['offset'] + field['bytes']]
        if sha(encoded) != field['sha256']: raise ValueError('Original delayed-curve field changed')
        if field['hash'] == name_hash('lifetime'):
            encoded = struct.pack('<IBBBf', name_hash('lifetime'), 133, 10, 1, struct.unpack('<f', bytes.fromhex('ffff7f7f'))[0])
        fields.append(encoded)
    fields.append(struct.pack('<IBf', name_hash('timeBeforeFirstEmission'), 10, .13))
    fields.append(struct.pack('<IBBBf', name_hash('emitterLinger'), 133, 10, 1, 11))
    loader = NativeVfxPostload(decoder, args.client)
    before = loader.load(fields); after = loader.postload()
    if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
        raise ValueError('Original delayed-curve field/postload boundary')
    controlled = n.prepare_camera({'phase': 'native-postload-callbacks-executed', **after})
    loader.restore_preload_arena()
    n.reset_parent(controlled, 1, 0, bound, system)
    old = bytes(n.u.mem_read(A['definition'], 0x470))
    n.fragment(0x16e17e6, 0x16e1860, {r.UC_X86_REG_RAX: A['definition'], r.UC_X86_REG_R15: A['link']})
    effective = bytes(n.u.mem_read(A['definition'], 0x470))
    variant_graph = json.loads(json.dumps(controlled))
    for segment in variant_graph['segments']:
        if segment['address'] == A['definition']:
            data = bytearray.fromhex(segment['bytesHex']); data[0x108:0x10c] = effective[0x108:0x10c]; segment['bytesHex'] = data.hex(); break
    else: raise ValueError('Controlled derived source missing')
    for seed in [1, 0x12345]:
        for variant, prepared in [('unclamped-control', controlled), ('original-single-clock-rewrite', variant_graph)]:
            n.reset_parent(controlled, seed, 0, bound, system)
            pre_rewrite_timers = bytes(n.u.mem_read(A['link'] + 0x90, 8))
            if variant == 'original-single-clock-rewrite':
                n.fragment(0x16e17e6, 0x16e1860, {r.UC_X86_REG_RAX: A['definition'], r.UC_X86_REG_R15: A['link']})
            rng = bytes(n.u.mem_read(A['stream'] + 8, 12))
            n.call(0x1756780, {r.UC_X86_REG_RDI: A['actor'], r.UC_X86_REG_RSI: A['system'], r.UC_X86_REG_RDX: A['link']}, 0x1756a26)
            if bytes(n.u.mem_read(A['stream'] + 8, 12)) != rng or bytes(n.u.mem_read(A['link'] + 0x90, 8)) != pre_rewrite_timers:
                raise ValueError('Final delayed actor changed original RNG/timers')
            frames = []; previous = [0, 0, 0]; initial_actor = bytes(n.u.mem_read(A['actor'], 0x128)).hex()
            for tick in range(61):
                time = tick / 60
                value = {'time': time, 'previous': previous, 'current': [time * 130, time * 3, time * 70],
                    'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                    'viewPosition': [0, 0, 1000], 'cameraRight': [1, 0, 0], 'cameraUp': [0, 1, 0],
                    'viewAxis': [0, 0, 1], 'multTexturePresent': False}
                output = n.frame_bound(value); frames.append({'input': value, 'output': output, 'linkTimersHex': bytes(n.u.mem_read(A['link'] + 0x90, 8)).hex()}); previous = value['current']
            cases.append({'effectId': identity, 'emitterIndex': index, 'seedHex': f'{seed:016x}',
                'scenario': 'typed-delay-with-authored-age-curve', 'controlledFields': {'lifetime': struct.unpack_from('<f', old, 0x108)[0], 'timeBeforeFirstEmission': struct.unpack_from('<f', old, 0x218)[0], 'emitterLinger': 11},
                'sourceLifetime': struct.unpack_from('<f', old, 0x108)[0], 'effectiveLifetime': struct.unpack_from('<f', effective, 0x108)[0],
                'variant': variant, 'preRewriteLinkTimersHex': pre_rewrite_timers.hex(), 'initialActorHex': initial_actor, 'frames': frames})
    for path, expected in {**inputs, **sources}.items():
        if sha(Path(path).read_bytes()) != expected: raise ValueError('Final single-clock provenance drift: ' + path)
    output = cache / 'research/direct-single-clock-native.json'
    output.write_text(json.dumps({'schema': 1, 'kind': 'native-single-clock-before-construction-control',
        'build': bound['build'], 'protocol': bound['protocol'], 'inputs': inputs, 'sources': sources,
        'originalBlocks': list(n.blocks.values()), 'ref': ref,
        'sourceLifetime': struct.unpack_from('<f', original_definition, 0x108)[0],
        'effectiveLifetime': struct.unpack_from('<f', rewritten_definition, 0x108)[0],
        'changedDefinitionByteOffsets': changed, 'cases': cases,
        'scope': {'completeAuthoredSourceRetained': True, 'originalSingleClockFragmentExecuted': True,
            'originalActorConstructorAfterDerivedField': True, 'temporaryEmptyActorPrelude': True,
            'originalTimersBeforeRewriteBeforeFinalActor': True, 'finalActorConstructorRngUnchanged': True, 'fullResourcePostloadExecuted': False,
            'materialAcquisitionExecuted': False, 'nativeWorldAcceptance': False, 'browserAcceptance': False}}, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'frames': sum(len(c['frames']) for c in cases)}))


if __name__ == '__main__': main()
