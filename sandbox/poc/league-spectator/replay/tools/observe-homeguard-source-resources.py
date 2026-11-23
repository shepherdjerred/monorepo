"""Read complete archived Homeguard BuffData properties and resolve Shared.

The original typed constructors, post-load registry insertion and runtime
resource factory execute. This supplies no recorded actor/buff membership.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from libc_ascii_compare_native import NativeAsciiCaseCompare
from effect_context_native import NativeEffectContexts
from buff_metadata_native import initialize_buff_metadata_types
from spell_preload_native import NativeSpellPreload
from ai_client_native import NativeAIClientInputs
from vfx_spawn_native import name_hash, sha


class NativeHomeguardSource(NativeAsciiCaseCompare, NativeCharacterAssets):
    # Reuse the original context operations without the independent VFX
    # fixture's eager quad construction or a second VM/constructor chain.
    registry = NativeEffectContexts.registry
    lookup_context = NativeEffectContexts.lookup_context


def string(n, pointer):
    data = bytearray()
    for index in range(4097):
        if not n.library_pointer(pointer+index, 1):
            raise ValueError('Original resource name exceeds owned storage')
        value = n.u.mem_read(pointer+index, 1)[0]
        if not value:
            return bytes(data).decode('ascii')
        if value >= 128:
            raise ValueError('Unproved non-ASCII resource name')
        data.append(value)
    raise ValueError('Original resource name exceeds4096bytes')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'input', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--initialize-spell-preload', action='store_true',
                        help='Execute the complete original cold spell-preload constructor; no archive/ready wrapper supplied')
    parser.add_argument('--request-source-preloads', action='store_true',
                        help='Request original preloads for the source-derived names, retaining unready wrappers explicitly')
    args = parser.parse_args()
    if args.request_source_preloads and not args.initialize_spell_preload:
        raise ValueError('Source preload requests need the complete original repository constructor')
    root = Path(__file__).resolve().parent
    encoded = args.input.read_bytes()
    request = json.loads(encoded)
    if (request['kind'] != 'original-homeguard-source-full-buff-property-input' or
            request['build'] != '16.21.829.8620' or request['protocol'] != '20e09df23c66b85e' or
            request['preparerSha256'] != sha((root/'prepare-native-homeguard-source-input.mjs').read_bytes()) or
            request['readerSha256'] != sha((root/'exact-map-bin.mjs').read_bytes()) or
            not 0 < len(request['records']) <= 10000):
        raise ValueError('Exact complete authored Homeguard buff source input required')
    for file, digest in request['inputs'].items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Homeguard source input changed: '+file)
    n = NativeHomeguardSource(args.cache/'public/decoder-16.21-macos', args.client)
    paths = {Path(__file__), Path(inspect.getfile(initialize_buff_metadata_types)), Path(inspect.getfile(NativeEffectContexts)),
             Path(inspect.getfile(NativeSpellPreload)),
             Path(inspect.getfile(NativeAIClientInputs)),
             *[Path(inspect.getfile(klass)) for klass in type(n).__mro__ if klass is not object]}
    sources = {str(file.resolve()): sha(file.read_bytes()) for file in paths}
    n.initialize_character_types()
    initialize_buff_metadata_types(n)
    audio = NativeAIClientInputs.initialize_audio_facade(n)
    if sha(n.image) != request['decoderImageSha256']:
        raise ValueError('Original Homeguard source image differs')
    # Resource factory diagnostics use this mutex even while their listener
    # manager is absent. Execute its actual independent startup constructor.
    n.call(0x14aa312, {}, 0x14aa32c)
    mutex = n.base+0x256c960
    if (n.u.reg_read(r.UC_X86_REG_RIP) != n.base+0x14aa32c or
            mutex not in n.character_mutexes or n.character_mutexes[mutex]['depth']):
        raise ValueError('Original resource diagnostic mutex initialization differs')
    n.call(0x35dd5c, {}, 0x35dd6e)
    registry = n.registry()
    shared = n.lookup_context(registry, 3579051965)
    if shared != registry+0x68 or n.q(n.q(shared)+0x30)-n.base != 0x35a270:
        raise ValueError('Original Shared context/getter differs')
    if n.q(n.base+0x246c978):
        raise ValueError('Original spell-name registry must be cold')
    spell_registry = n.allocate(0x50)
    n.call(0x8325b0, {r.UC_X86_REG_RDI: spell_registry})
    if n.q(n.base+0x246c978) != spell_registry:
        raise ValueError('Original spell-name registry publication differs')
    cases, boundary, active, spell_preloads = [], None, None, None
    try:
        if args.initialize_spell_preload:
            spell_preloads = NativeSpellPreload.initialize_spell_preload_manager(n)
        for item in request['records']:
            active = {key: item[key] for key in ['sourceSha256', 'ownerPathHash', 'registeredName']}
            raw = Path(item['source']['file']).read_bytes()
            if sha(raw) != item['sourceSha256'] or len(raw) != item['source']['bytes']:
                raise ValueError('Exact whole authored BuffData source differs')
            fields = []
            for span in item['fields']:
                offset, size = span['offset'], span['bytes']
                if not 0 <= offset <= len(raw)-size or not 5 <= size <= 1024*1024:
                    raise ValueError('Whole original buff property exceeds source/bound')
                field = raw[offset:offset+size]
                if sha(field) != span['sha256']:
                    raise ValueError('Whole original buff property digest differs')
                fields.append(field)
            read = n.observe_actor_fields(name_hash('SpellObject'), fields)
            spell = read['object']
            if read['originalSkippedFields'] or read['pendingReferences'] or n.q(spell+0x70):
                raise ValueError('Complete original buff source still has an unsupported reader/reference')
            buff = n.q(spell+0x60)
            if not n.library_pointer(buff, 128) or n.u.mem_read(buff+0x7c, 1)[0] != item['expectedAttributeByte']:
                raise ValueError('Whole original buff property attribute differs')
            n.call(0x66a546, {}, 0x66a57f)
            n.call(0x861563, {r.UC_X86_REG_RBX: spell}, 0x8615aa)
            selected_name = string(n, n.q(buff+0x10))
            if selected_name != item['registeredName']:
                raise ValueError('Whole original buff name differs from dependency projection')
            preload = None
            if args.request_source_preloads:
                n.call(0x84b9d0, {r.UC_X86_REG_RDI: spell_preloads['object']+8,
                                 r.UC_X86_REG_RSI: shared, r.UC_X86_REG_RDX: n.q(buff+0x10)})
                at = n.u.reg_read(r.UC_X86_REG_RAX)
                if at and not n.library_pointer(at, 0xb8):
                    raise ValueError('Original source preload wrapper escaped owned storage')
                preload = {'returnedResource': at, 'allocatedBytes': n.allocations.get(at),
                           'objectHex': bytes(n.u.mem_read(at, 0xb8)).hex() if at else None,
                           'readinessEstablished': False}
            n.call(0x8601a0, {r.UC_X86_REG_RDI: item['resourceNameHash'], r.UC_X86_REG_RSI: shared})
            resource = n.u.reg_read(r.UC_X86_REG_RAX)
            if not resource:
                cases.append(active | {'resourceNameHash': item['resourceNameHash'], 'contextId': 3579051965,
                                       'originalTypedRead': read, 'originalResource': 0,
                                       'sourcePreload': preload,
                                       'resourceStatus': 'unavailable-original-factory-returned-null',
                                       'attributeByte': item['expectedAttributeByte']})
                continue
            if not n.library_pointer(resource, 0x10):
                raise ValueError('Original Shared runtime buff resource escaped owned storage')
            resource_name = string(n, n.q(resource+8))
            if resource_name != selected_name:
                raise ValueError('Original runtime resource name differs from authored BuffData')
            cases.append(active | {'resourceNameHash': item['resourceNameHash'], 'contextId': 3579051965,
                                   'originalTypedRead': read, 'originalResource': resource,
                                   'sourcePreload': preload,
                                   'originalResourceName': resource_name, 'resourceStatus': 'resolved',
                                   'attributeByte': item['expectedAttributeByte']})
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error), 'active': active,
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'rdi': n.u.reg_read(r.UC_X86_REG_RDI),
                    'nativeCallerRva': n.q(n.u.reg_read(r.UC_X86_REG_RSP))-n.base,
                    'initializedMutexes': list(n.mutexes)}
    for file, digest in {**sources, **request['inputs']}.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Homeguard resource source changed during controls: '+file)
    if args.input.read_bytes() != encoded:
        raise ValueError('Homeguard source input changed during controls')
    unavailable = sum(row['originalResource'] == 0 for row in cases)
    output = {'schema': 1, 'kind': 'original-homeguard-source-resource-observation', 'build': request['build'],
              'protocol': request['protocol'], 'decoderImageSha256': sha(n.image), 'inputSha256': sha(encoded),
              'sources': sources, 'cases': cases, 'boundary': boundary, 'originalBlocks': list(n.blocks.values()),
              'spellPreloadSetup': spell_preloads,
              'audioFacadeSetup': audio,
              'independentStartupBlocks': [[0x14aa312, 0x14aa32c]],
              'scope': {'completeAuthoredBuffPropertyRead': boundary is None,
                        'originalSharedResourceFactoryExecuted': boundary is None,
                        'sourceDerivedNamedMetadataMatched': boundary is None and not unavailable,
                        'allSourceResourcesResolved': boundary is None and not unavailable,
                        'recordedBuffMembershipEstablished': False, 'liveHomeguardProviderAdmitted': False}}
    args.output.write_text(json.dumps(output, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'cases': len(cases), 'unavailableResources': unavailable, 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)
    if unavailable:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
