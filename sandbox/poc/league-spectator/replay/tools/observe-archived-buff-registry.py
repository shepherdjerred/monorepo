"""Original typed buff names, post-load registration and two-index lookup.

Each source object receives a fresh original cold registry. This is not the
match's resource loading order, context specialization or buff membership.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from buff_metadata_native import initialize_buff_metadata_types
from libc_ascii_compare_native import NativeAsciiCaseCompare
from vfx_spawn_native import name_hash, sha


class NativeBuffRegistry(NativeAsciiCaseCompare, NativeCharacterAssets):
    pass


def cstring(n, pointer):
    if not pointer:
        raise ValueError('Original registered name is null')
    data = bytearray()
    for offset in range(4097):
        byte = n.u.mem_read(pointer+offset, 1)[0]
        if byte == 0:
            return bytes(data).decode('ascii')
        if byte >= 128:
            raise ValueError('Unproved non-ASCII buff resource name')
        data.append(byte)
    raise ValueError('Original buff name exceeds4096bytes')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'input', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    encoded = args.input.read_bytes()
    request = json.loads(encoded)
    if (request['kind'] != 'original-buff-registry-projection-input' or
            request['build'] != '16.21.829.8620' or request['protocol'] != '20e09df23c66b85e' or
            request['sources']['preparerSha256'] != sha((root/'prepare-native-buff-registry-input.mjs').read_bytes()) or
            request['sources']['readerSha256'] != sha((root/'exact-map-bin.mjs').read_bytes()) or
            not 0 < len(request['records']) <= 10000):
        raise ValueError('Exact bounded original buff registration input required')
    for file, expected in request['inputs'].items():
        if sha(Path(file).read_bytes()) != expected:
            raise ValueError('Original buff registration source changed: '+file)
    n = NativeBuffRegistry(args.cache/'public/decoder-16.21-macos', args.client)
    paths = {Path(__file__), Path(inspect.getfile(initialize_buff_metadata_types)),
             *[Path(inspect.getfile(klass)) for klass in type(n).__mro__ if klass is not object]}
    sources = {str(file.resolve()): sha(file.read_bytes()) for file in paths}
    n.initialize_character_types()
    initializers = initialize_buff_metadata_types(n)
    if sha(n.image) != request['decoderImageSha256']:
        raise ValueError('Original buff registration image differs')
    cases, boundary, active = [], None, None
    source_cache = {}
    try:
        for item in request['records']:
            active = {key: item[key] for key in ['sourceSha256', 'ownerPathHash']}
            path = item['source']['file']
            if path not in source_cache:
                raw = Path(path).read_bytes()
                if sha(raw) != item['sourceSha256'] or len(raw) != item['source']['bytes']:
                    raise ValueError('Original buff registry raw BIN differs')
                source_cache[path] = raw
            raw = source_cache[path]
            fields = []
            for span in item['nameFields']:
                offset, size = span['offset'], span['bytes']
                if not 0 <= offset <= len(raw)-size or size < 7:
                    raise ValueError('Original buff name field escaped its source')
                field = raw[offset:offset+size]
                if (sha(field) != span['sha256'] or field[4] != 0x10 or
                        struct.unpack_from('<H', field, 5)[0] != len(field)-7 or
                        field[7:].decode('ascii') != span['expectedValue'] or
                        '%08x'%struct.unpack_from('<I', field)[0] != span['fieldHash'] or
                        span['fieldHash'] not in ['e095d841', 'c8e37ef0', '34cdd819']):
                    raise ValueError('Original buff typed name bytes differ')
                fields.append(field)
            attributes = []
            if len(item['fields']) > 1:
                raise ValueError('One exact BuffData byte dependency required')
            for span in item['fields']:
                offset, size = span['offset'], span['bytes']
                if not 0 <= offset <= len(raw)-size or size != 6:
                    raise ValueError('Original BuffData attribute escaped source')
                field = raw[offset:offset+size]
                if (sha(field) != span['sha256'] or
                        struct.unpack_from('<IB', field) != (0xd7e2c71d, 3)):
                    raise ValueError('Original BuffData attribute bytes differ')
                attributes.append(field)
            # An explicitly derived property projection. Original constructors
            # and pointer/U8 readers run; other fields remain in immutable BINs.
            body = b''.join(attributes)
            fields.append(struct.pack('<IBIIH', 0x7f0f5a79, 0x82, 0x4633d794,
                                      2+len(body), len(attributes))+body)
            read = n.observe_actor_fields(name_hash('SpellObject'), fields)
            spell = read['object']
            buff = n.q(spell+0x60)
            if (read['pendingReferences'] or read['originalSkippedFields'] or
                    n.q(spell+0x70) or not n.library_pointer(buff, 128) or
                    n.u.mem_read(buff+0x7c, 1)[0] != item['expectedAttributeByte']):
                raise ValueError('Original buff projection typed reader differs')
            # Actual startup allocation and native map-header initialization.
            n.call(0x66a546, {}, 0x66a57f)
            if n.u.reg_read(r.UC_X86_REG_RIP) != n.base+0x66a57f:
                raise ValueError('Original buff registry startup boundary differs')
            registry = n.q(n.base+0x246ece0)
            if (not n.library_pointer(registry, 0x38) or n.q(registry+8) != registry+0x10 or
                    n.q(registry+0x10) or n.q(registry+0x18) or
                    n.q(registry+0x20) != registry+0x28 or n.q(registry+0x28) or n.q(registry+0x30)):
                raise ValueError('Original cold buff registry map header differs')
            # Actual SpellObject name selection/copy and complete insertion.
            n.call(0x861563, {r.UC_X86_REG_RBX: spell}, 0x8615aa)
            if n.u.reg_read(r.UC_X86_REG_RIP) != n.base+0x8615aa:
                raise ValueError('Original buff post-load boundary differs')
            pointer = n.q(buff+0x10)
            selected_name = cstring(n, pointer)
            n.call(0x144b3a0, {r.UC_X86_REG_RDI: pointer})
            identity = n.u.reg_read(r.UC_X86_REG_RAX) & 0xffffffff
            n.call(0x83cac0, {r.UC_X86_REG_RDI: registry, r.UC_X86_REG_RSI: identity})
            looked_up_name = cstring(n, n.u.reg_read(r.UC_X86_REG_RAX))
            if looked_up_name != selected_name:
                raise ValueError('Complete original hash/name registry lookup differs')
            # The exact two-index lookup suffix after the already executed
            # original name hash. No live BuffInstance/resource pointer supplied.
            n.call(0x83c9f8, {r.UC_X86_REG_RAX: identity, r.UC_X86_REG_R14: registry}, 0x83caa8)
            if (n.u.reg_read(r.UC_X86_REG_RIP) != n.base+0x83caa8 or
                    n.u.reg_read(r.UC_X86_REG_RAX) != buff):
                raise ValueError('Original two-index metadata lookup did not return authored BuffData')
            n.call(0x830bc0, {r.UC_X86_REG_RDI: buff, r.UC_X86_REG_RSI: 2})
            predicate = bool(n.u.reg_read(r.UC_X86_REG_RAX) & 255)
            if predicate != bool(item['expectedAttributeByte'] & 2):
                raise ValueError('Original registered metadata attribute differs')
            cases.append(active | {'registeredName': selected_name, 'resourceNameHash': identity,
                                   'attributeByte': item['expectedAttributeByte'], 'originalMask2Result': predicate,
                                   'originalTypedRead': read})
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error), 'active': active,
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    for file, expected in {**sources, **request['inputs']}.items():
        if sha(Path(file).read_bytes()) != expected:
            raise ValueError('Buff registry source changed during controls: '+file)
    if args.input.read_bytes() != encoded:
        raise ValueError('Buff registration input changed during controls')
    output = {'schema': 1, 'kind': 'original-archived-buff-registry-observation',
              'build': request['build'], 'protocol': request['protocol'], 'decoderImageSha256': sha(n.image),
              'inputSha256': sha(encoded), 'sources': sources, 'initializers': initializers,
              'cases': cases, 'unavailable': request['unavailable'], 'boundary': boundary,
              'platformAsciiCaseComparisons': n.ascii_case_compare_calls,
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalTypedNameAttributeProjectionRead': boundary is None,
                        'originalColdRegistryStartupExecuted': boundary is None,
                        'originalPostLoadNameSelectionAndRegistrationExecuted': boundary is None,
                        'originalHashAndTwoIndexLookupCompared': boundary is None,
                        'oneColdRegistryPerSourceObject': True, 'actualMatchResourceLoadingOrderEstablished': False,
                        'contextSpecializationExecuted': False, 'buffMembershipEstablished': False,
                        'liveAnimationProviderAdmitted': False}}
    args.output.write_text(json.dumps(output, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'cases': len(cases),
                      'mask2True': sum(row['originalMask2Result'] for row in cases), 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
