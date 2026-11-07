"""Original positive gear resource projection over complete installed gear fields.

Development control: stops immediately after the original selected-resolver push.
It does not establish pose equivalence or full opcode129 match acceptance.
"""
import argparse
import inspect
import io
import json
import sys
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from ai_hero_type_native import initialize_hero_client_types
from mode_dependency_types_native import initialize_mode_dependency_types
from process_arguments_native import initialize_product_configuration
from ai_hero_stack_native import NativeHeroStackProbe
from ai_client_native import NativeAIClientInputs
from libcpp_shared_native import NativeLibcppSharedOwnership
from vfx_spawn_native import ADDRESSES, sha


class Control(NativeHeroStackProbe, NativeLibcppSharedOwnership, NativeAIClientInputs):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('--actor', default='champions/katarina/29')
    args = parser.parse_args()
    tools = Path(__file__).resolve().parent
    source_paths = {Path(__file__).resolve(), *[Path(module.__file__).resolve()
        for module in sys.modules.values() if getattr(module, '__file__', None)
        and Path(module.__file__).suffix == '.py'
        and Path(module.__file__).resolve().is_relative_to(tools)]}
    sources = {str(path): sha(path.read_bytes()) for path in source_paths}
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n, cache = fixture.native, fixture.cache
    effects = fixture.read(cache/'public/latest-effects/manifest.json')
    package = fixture.read(cache/'public/latest-effects/package.json')
    actor = effects['actors'][args.actor]
    import cdtb.binfile as binfile
    for dictionary in [binfile.hashfile_binfields, binfile.hashfile_bintypes,
                       binfile.hashfile_binentries, binfile.hashfile_binhashes,
                       binfile.hashfile_binhashes_xxh3, binfile.hashfile_binpaths]:
        dictionary.hashes = {}

    class Reader(binfile.BinReader):
        def __init__(self, *a):
            super().__init__(*a)
            self.spans = {}

        def read_field(self, kind):
            start = self.f.tell()
            field = super().read_field(kind)
            self.spans[id(field)] = (start, self.f.tell())
            return field

    entries = {}
    for source in package['actors'][args.actor]['sourceBins']:
        stem = source['sourceSha256']+'-'+effects['toolchain']['parserIdentity'][:16]
        raw = fixture.raw(cache/'research/latest-effects/bins'/(stem+'.bin'))
        if sha(raw) != source['sourceSha256'] or raw[:4] != b'PROP':
            raise ValueError('Installed actor BIN changed')
        stream = io.BytesIO(raw)
        stream.read(4)
        reader = Reader(stream)
        _, _, types = reader.read_binfile_header()
        for entry in [reader.read_binfile_entry(t) for t in types]:
            fields = [raw[a:z] for a, z in [reader.spans[id(f)] for f in entry.fields]]
            entries[entry.path.h] = (entry.type.h, fields)
    n.initialize_character_types()
    skin_roots = [(key, fields) for key, (kind, fields) in entries.items() if kind == 0x9b67e9f6]
    if len(skin_roots) != 1:
        raise ValueError('Unique installed skin root required')
    skin_fields = [f for f in skin_roots[0][1] if int.from_bytes(f[:4], 'little') == 0x68f2b69c]
    skin = n.observe_actor_fields(0x9b67e9f6, skin_fields)
    if skin['originalSkippedFields']:
        raise ValueError('Original skin upgrade field skipped')
    gears = {}
    for link in skin['pendingReferences']:
        kind, fields = entries[link['identity']]
        if kind != 0x27dd6361:
            continue
        loaded = n.observe_actor_fields(kind, fields)
        if loaded['originalSkippedFields']:
            raise ValueError('Original installed gear fields skipped')
        gears[link['identity']] = loaded
    loaded_entries = dict(gears)
    pending = [*skin['pendingReferences'], *[p for g in gears.values() for p in g['pendingReferences']]]
    next_link = 0
    while next_link < len(pending):
        link = pending[next_link]
        next_link += 1
        identity = link['identity']
        if identity == 0:
            continue
        if identity in loaded_entries:
            continue
        if identity not in entries:
            raise ValueError('Installed gear dependency missing: '+hex(identity))
        kind, fields = entries[identity]
        loaded = n.observe_actor_fields(kind, fields)
        if loaded['originalSkippedFields']:
            raise ValueError('Original linked definition skipped fields: '+repr((hex(identity), loaded['originalSkippedFields'])))
        loaded_entries[identity] = loaded
        pending.extend(loaded['pendingReferences'])
        if len(loaded_entries) > 4096 or len(pending) > 65536:
            raise ValueError('Installed gear dependency closure exceeds bound')
    library, table = n.allocate(0x48), n.allocate(len(loaded_entries)*24)
    queue, context = n.allocate(len(pending)*16), n.allocate(24)
    for i, (identity, loaded) in enumerate(sorted(loaded_entries.items())):
        n.put(table+i*24, 'QQII', loaded['object'], n.types[loaded['typeHash']], identity, 0)
    n.put(library+0x10, 'QII', table, len(loaded_entries), len(loaded_entries))
    for i, link in enumerate(pending):
        n.put(queue+i*16, 'QQ', link['destination'], link['expectedType'])
    n.put(context, 'QQII', library, queue, len(pending), len(pending))
    n.call(0x14bbf40, {r.UC_X86_REG_RDI: context})
    if n.u32(context+0x10):
        raise ValueError('Original gear link fixup incomplete')
    n.call(0x665f24, {}, 0x665f51)
    n.initialize_audio_facade()
    n.initialize_ui_data_prefix()
    initialize_product_configuration(n, 'LoL')
    initialize_mode_dependency_types(n)
    initialize_hero_client_types(n, reuse_existing=True)
    unit = n.allocate(0x4aa0)
    n.call(0x154c10, {r.UC_X86_REG_RDI: unit})
    name, skin_id = args.actor.split('/')[1:]
    name = actor.get('champion', name.capitalize())
    storage_key = n.allocate(0x28)
    for offset, value in [(0, name), (0x10, '')]:
        n.call(0x14c2d60, {r.UC_X86_REG_RDI: storage_key+offset,
                          r.UC_X86_REG_RSI: n.allocate_text(value)})
    n.put(storage_key+0x20, 'II', int(skin_id), 0)
    fixture.run_to(0x67c20, 0x67c57, {r.UC_X86_REG_RDI: unit+0x35e0,
                                    r.UC_X86_REG_RSI: storage_key})
    resource = n.prepare_cache([{'name': name, 'namespace': '', 'skinId': int(skin_id),
                                'keyFlags': 0, 'context': 0}])[0]['object']
    character_context = n.character_context(name, int(skin_id))
    n.call(0x2a69b3, {r.UC_X86_REG_RBX: resource,
                      r.UC_X86_REG_RAX: character_context['object']}, 0x2a69b7)
    n.call(0x2a766f, {r.UC_X86_REG_RAX: skin['object'], r.UC_X86_REG_RBX: resource}, 0x2a7677)
    render, handle = n.allocate(0x1a8), n.allocate(8)
    n.put(handle, 'Q', resource)
    fixture.run_to(0x76bb40, 0x76bc8c, {r.UC_X86_REG_RDI: render,
        r.UC_X86_REG_RSI: unit, r.UC_X86_REG_RDX: unit+0x40,
        r.UC_X86_REG_RCX: handle})
    frame = ADDRESSES['stack']+0x100
    n.call(0x1303dd, {r.UC_X86_REG_RBP: frame}, 0x1303e8)
    n.call(0x130428, {r.UC_X86_REG_RBX: render, r.UC_X86_REG_RBP: frame,
                     r.UC_X86_REG_R14: unit+0x118}, 0x130469)
    if n.q(frame-0x38) != n.base+0x2566c00:
        raise ValueError('Original render registration key differs')
    n.call(0x37f7d0, {r.UC_X86_REG_RDI: unit+0x118})
    group = n.u.reg_read(r.UC_X86_REG_RAX)
    n.call(0x548bf0, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: character_context['object']})
    # Full original lazy producer obtains this exact static cache and copies the
    # original resolved ordered gear links. No form table is host-written.
    lazy_visits = []
    lazy_hooks = [n.u.hook_add(unicorn.UC_HOOK_CODE,
        lambda uc, address, size, user: lazy_visits.append({'rva': address-n.base,
            'r14': uc.reg_read(r.UC_X86_REG_R14), 'rdi': uc.reg_read(r.UC_X86_REG_RDI),
            'rax': uc.reg_read(r.UC_X86_REG_RAX)}),
        begin=n.base+at, end=n.base+at) for at in [0xbf93a, 0x30d220, 0x30d3f3, 0x30d510,
            0x30d53e, 0x30d5bf, 0x30d642, 0x30e30c, 0xbf95c]]
    try:
        n.call(0xbf8b0, {r.UC_X86_REG_RDI: unit})
    except Exception:
        print(json.dumps({'lazyProducerBoundary': {
            'rva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
            'callerRva': n.q(n.u.reg_read(r.UC_X86_REG_RSP))-n.base,
            'registers': {name: n.u.reg_read(getattr(r, 'UC_X86_REG_'+name))
                          for name in ['RDI', 'RSI', 'RAX', 'RBX', 'R12', 'R13', 'R14']}}}), flush=True)
        raise
    finally:
        for hook in lazy_hooks:
            n.u.hook_del(hook)
    print(json.dumps({'lazyVisits': lazy_visits}), flush=True)
    if n.u.reg_read(r.UC_X86_REG_RAX)&255 != 1:
        raise ValueError('Original lazy producer rejected installed linked gear table')
    created = [visit for visit in lazy_visits if visit['rva'] == 0x30d220]
    if len(created) != 1:
        raise ValueError('Unique originally registered form component required')
    component = created[0]['rdi']
    begin, end = n.q(component+0x10), n.q(component+0x18)
    ordered = [n.q(at) for at in range(begin, end, 8)]
    expected = [n.q(gears[link['identity']]['object']+8) for link in skin['pendingReferences']
                if link['identity'] in gears]
    if ordered != expected:
        raise ValueError('Original lazy producer changed installed gear order: '+repr((ordered, expected)))
    visits = []
    watched = [0x30ed00, 0x3774f0, 0x377390, 0x377380, 0x548bf0, 0xcc140]
    hooks = [n.u.hook_add(unicorn.UC_HOOK_CODE,
        lambda uc, address, size, user: visits.append(address-n.base),
        begin=n.base+at, end=n.base+at) for at in watched]
    controls, boundary = [], None
    def stack():
        return [n.q(at) for at in range(n.q(group+0x18), n.q(group+0x20), 8)]
    for index, flag in [(0, False), (0, True), (min(2, len(ordered)-1), False),
                        (min(2, len(ordered)-1), True), (0, False), (0, True)]:
        previous = n.u.mem_read(component+0x28, 1)[0]
        before = stack()
        visits.clear()
        try:
            n.call(0x30ed00, {r.UC_X86_REG_RDI: component, r.UC_X86_REG_RSI: index,
                              r.UC_X86_REG_RDX: unit, r.UC_X86_REG_RCX: int(flag)}, 0x30f11a)
            after = stack()
            expected_stack = before.copy()
            if previous < len(ordered):
                old = n.q(ordered[previous]+0x158)
                if old in expected_stack:
                    expected_stack.remove(old)
            selected = n.q(ordered[index]+0x158)
            if selected in expected_stack:
                expected_stack.remove(selected)
            expected_stack.append(selected)
            if after != expected_stack or n.u.mem_read(component+0x28, 1)[0] != index:
                raise ValueError('Original positive resource stack/index transition differs')
            controls.append({'previous': previous, 'index': index, 'nativeFlag': flag,
                             'selectedIndex': n.u.mem_read(component+0x28, 1)[0],
                             'before': before, 'after': after,
                             'visits': list(visits)})
        except Exception as error:
            boundary = {'kind': type(error).__name__, 'message': str(error),
                        'rva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                        'callerRva': n.q(n.u.reg_read(r.UC_X86_REG_RSP))-n.base,
                        'visits': list(visits)}
            break
    full_controls, full_boundary = [], None
    codec = fixture.read(cache/'public/latest-unit-form-inputs/package.json')
    packet = n.allocate(codec['objectSize'])
    if boundary is None:
        for index, flag in [(255, False), (0, True), (0, False), (min(2, len(ordered)-1), True), (0, True)]:
            body = bytearray(codec['objectSize'])
            body[0x10] = codec['decode']['index'].index(index)
            body[0x11] = codec['decode']['nativeFlag'].index(flag)
            n.u.mem_write(packet, bytes(body))
            visits.clear()
            before = stack()
            try:
                n.call(0xfdd00, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: packet})
                if n.u.reg_read(r.UC_X86_REG_RAX)&255 != 1:
                    raise ValueError('Complete original129 listener did not accept control')
                if index == 255 and before != stack():
                    raise ValueError('Complete original negative listener changed actual gear resources')
                full_controls.append({'index': index, 'nativeFlag': flag, 'bytesHex': body.hex(),
                                      'before': before, 'after': stack(), 'visits': list(visits)})
            except Exception as error:
                full_boundary = {'kind': type(error).__name__, 'message': str(error),
                    'rva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'frameCallerRva': n.q(n.u.reg_read(r.UC_X86_REG_RBP)+8)-n.base,
                    'registers': {name: n.u.reg_read(getattr(r, 'UC_X86_REG_'+name))
                                  for name in ['RAX', 'RBX', 'RDI', 'RSI', 'RBP']},
                    'dependency': 'original-render-model-table76e820-missed-and-returned-null-node-plus18-before-unit-model+10-dereference'
                                  if n.u.reg_read(r.UC_X86_REG_RIP)-n.base == 0x112961 else 'unclassified-native-boundary',
                    'index': index, 'nativeFlag': flag, 'visits': list(visits)}
                break
    for hook in hooks:
        n.u.hook_del(hook)
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Native resource producer changed during observation: '+path)
    result = {'schema': 1, 'kind': 'original-positive-form-resource-projection',
              'actorKey': args.actor, 'build': n.profile['clientVersion'],
              'protocol': n.profile['protocolDigest'], 'decoderImageSha256': sha(n.image),
              'inputs': fixture.inputs, 'sources': sources,
              'originalBlocks': list(n.blocks.values()), 'orderedGearPointers': ordered,
              'controls': controls, 'boundary': boundary, 'lazyVisits': lazy_visits,
              'fullListenerControls': full_controls, 'fullListenerBoundary': full_boundary,
              'scope': {'actualInstalledGearTableLoadedAndLinked': True,
                        'originalLazyProducerExecuted': True,
                        'resourcePrefixThroughSelectedPushExecuted': boundary is None,
                        'completeOpcode129Executed': full_boundary is None and len(full_controls) == 5,
                        'poseEquivalent': False,
                        'nativeReplayAcceptance': None, 'productionEligibilityChanged': False}}
    output = cache/'research'/('positive-form-resource-'+args.actor.replace('/', '-')+'-native.json')
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls), 'boundary': boundary,
                      'fullListenerControls': len(full_controls), 'fullListenerBoundary': full_boundary}))


if __name__ == '__main__':
    main()
