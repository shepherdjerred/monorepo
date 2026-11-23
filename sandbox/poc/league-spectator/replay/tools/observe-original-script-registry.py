"""Original archived script-manifest parser and pre-I/O path candidates.

The input stream ABI reads only verified archived bytes. Original registry data
construction, manifest grammar and path selection execute unchanged. Path
queries stop before archive existence is requested; no success is supplied.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
import unicorn
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from effect_context_native import NativeEffectContexts
from buff_metadata_native import initialize_buff_metadata_types
from vfx_asset_native import CALLBACK, VTABLE
from vfx_spawn_native import ADDRESSES, sha, name_hash

FRAME = 0x100f5000
STREAM = FRAME-0x38


class NativeScriptRegistry(NativeCharacterAssets):
    registry = NativeEffectContexts.registry
    lookup_context = NativeEffectContexts.lookup_context

    def __init__(self, *args):
        self.script_input = None
        self.script_cursor = 0
        self.script_reads = []
        super().__init__(*args)

    def stream_service(self, engine, address, size, user):
        if self.script_input is None:
            return super().stream_service(engine, address, size, user)
        if engine.reg_read(r.UC_X86_REG_RDI) != STREAM or address != CALLBACK:
            raise ValueError('Original script parser escaped its owned read stream')
        target, count = engine.reg_read(r.UC_X86_REG_RSI), engine.reg_read(r.UC_X86_REG_RDX)
        if (not 0 <= count <= len(self.script_input)-self.script_cursor or
                not 0x10000000 <= target <= 0x12000000-count):
            raise ValueError('Original script stream exceeded source/storage bounds')
        if count:
            engine.mem_write(target, self.script_input[self.script_cursor:self.script_cursor+count])
        self.script_reads.append({'offset': self.script_cursor, 'bytes': count})
        self.script_cursor += count
        engine.reg_write(r.UC_X86_REG_RAX, count)
        self.ret()


def run_bounded(n, entry, stop, registers):
    n.u.context_restore(n.initial)
    n.put(ADDRESSES['stack'], 'Q', ADDRESSES['stop'])
    n.u.reg_write(r.UC_X86_REG_RSP, ADDRESSES['stack'])
    for register, value in registers.items():
        n.u.reg_write(register, value)
    hook = n.u.hook_add(unicorn.UC_HOOK_CODE,
                        lambda engine, address, size, user: engine.emu_stop(),
                        begin=n.base+stop, end=n.base+stop)
    slices, start = [], n.base+entry
    try:
        for index in range(64):
            n.u.emu_start(start, n.base+stop, count=5000000)
            start = n.u.reg_read(r.UC_X86_REG_RIP)
            slices.append({'slice': index+1, 'instructionsBound': 5000000, 'stopRva': start-n.base})
            if start == n.base+stop:
                return slices
    finally:
        n.u.hook_del(hook)
    raise ValueError('Original script registry parser exceeds64bounded CPU slices')


def native_string(n, at):
    pointer, size = n.q(at), n.u32(at+8)
    if size > 4096 or not n.library_pointer(pointer, size+1) or n.u.mem_read(pointer+size, 1)[0]:
        raise ValueError('Original script path exceeds owned terminated storage')
    return bytes(n.u.mem_read(pointer, size)).decode('ascii')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'input_root', 'source_evidence', 'name_input', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    package = args.cache/'public/decoder-16.21-macos'
    manifest_bytes = (args.input_root/'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    evidence_bytes = args.source_evidence.read_bytes()
    evidence = json.loads(evidence_bytes)
    names_bytes = args.name_input.read_bytes()
    names = json.loads(names_bytes)
    if (manifest['kind'] != 'archived-original-script-registry-input-candidates' or
            manifest['build'] != '16.21.829.8620' or manifest['protocol'] != '20e09df23c66b85e' or
            manifest['sourceEvidenceSha256'] != sha(evidence_bytes) or
            evidence['kind'] != 'original-script-file-manifest-source-reference' or
            manifest['requestedNamespace'] != evidence['file'] or
            names['kind'] != 'original-homeguard-source-full-buff-property-input'):
        raise ValueError('Exact archived script manifest/source evidence and native-derived names required')
    present = [row for row in manifest['records'] if row['present']]
    if len(present) != 1 or present[0]['wad'] != 'DATA/FINAL/Scripts.wad.client':
        raise ValueError('One explicit original Scripts archive owner required')
    selected = present[0]
    if selected['file'] != 'source-0.bin' or not 4 <= selected['bytes'] <= 8*1024*1024:
        raise ValueError('Bounded exact script registry input file required')
    data_path = args.input_root/selected['file']
    data = data_path.read_bytes()
    if sha(data) != selected['sha256'] or len(data) != selected['bytes']:
        raise ValueError('Original script manifest byte identity differs')
    for file, expected in names['inputs'].items():
        if sha(Path(file).read_bytes()) != expected:
            raise ValueError('Native-derived script name input changed: '+file)
    n = NativeScriptRegistry(package, args.client)
    paths = {Path(__file__), Path(inspect.getfile(NativeEffectContexts)), Path(inspect.getfile(initialize_buff_metadata_types)),
             *[Path(inspect.getfile(klass)) for klass in type(n).__mro__ if klass is not object]}
    sources = {str(file.resolve()): sha(file.read_bytes()) for file in paths}
    if sha(n.image) != evidence['decoderImageSha256'] or sha(n.image) != names['decoderImageSha256']:
        raise ValueError('Original script registry image differs from source/name proof')
    for block in evidence['sourceBlocks']:
        if sha(n.image[block['rva']:block['rva']+block['bytes']]) != block['sha256']:
            raise ValueError('Original script registry parser source block differs')
    n.initialize_character_types()
    initialize_buff_metadata_types(n)
    registry = n.allocate(0x40)
    # Original class data constructor, stopping before its archive-file open.
    n.call(0x8529e0, {r.UC_X86_REG_RDI: registry}, 0x852a21)
    if n.q(n.base+0x24712a0) != registry or any(n.u.mem_read(registry+0x10, 0x30)):
        raise ValueError('Original script registry constructor/header differs')
    n.u.mem_write(FRAME-0x200, bytes(0x200))
    n.put(STREAM, 'Q', VTABLE)
    n.put(VTABLE+0x10, 'Q', CALLBACK)
    n.script_input = data
    boundary, slices, fields, queries = None, [], None, []
    try:
        slices = run_bounded(n, 0x8528ed, 0x852989,
                             {r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_RBX: registry})
        if n.script_cursor != len(data):
            raise ValueError('Original script parser did not consume the complete archived manifest')
        n.script_input = None
        string_count, strings = n.u32(registry+0x18), n.q(registry+0x10)
        packed_count, packed = n.u32(registry+0x38), n.q(registry+0x30)
        if (not 0 < string_count <= 65536 or not 0 < packed_count <= 1000000 or
                not n.library_pointer(strings, string_count*16) or not n.library_pointer(packed, packed_count*8)):
            raise ValueError('Original script registry arrays exceed bounded owned storage')
        fields = {'strings': [native_string(n, strings+index*16) for index in range(string_count)],
                  'packedValuesHex': ['%016x'%n.q(packed+index*8) for index in range(packed_count)]}
        n.call(0x35dd5c, {}, 0x35dd6e)
        contexts = n.registry()
        shared = n.lookup_context(contexts, 3579051965)
        if shared != contexts+0x68:
            raise ValueError('Original Shared context differs')
        for item in names['records']:
            name = item['registeredName']
            if not name or len(name) > 4096 or any(ord(char) >= 128 for char in name):
                raise ValueError('Bounded source-derived ASCII script name required')
            owner_bytes = Path(item['source']['file']).read_bytes()
            if sha(owner_bytes) != item['sourceSha256']:
                raise ValueError('Original script name owner bytes differ')
            source_fields = []
            for span in item['fields']:
                offset, size = span['offset'], span['bytes']
                if not 0 <= offset <= len(owner_bytes)-size:
                    raise ValueError('Original script name field escaped source')
                field = owner_bytes[offset:offset+size]
                if sha(field) != span['sha256']:
                    raise ValueError('Original script name field digest differs')
                source_fields.append(field)
            source_read = n.observe_actor_fields(name_hash('SpellObject'), source_fields)
            if source_read['originalSkippedFields'] or source_read['pendingReferences']:
                raise ValueError('Original script name source retains unsupported fields/references')
            owner = source_read['object']
            # Original source name selection/copy, stopping before registry
            # registration. Its result is a GameString object, not a C pointer.
            n.call(0x861563, {r.UC_X86_REG_RBX: owner}, 0x86159a)
            source = n.q(owner+0x60)+0x10
            if native_string(n, source) != name:
                raise ValueError('Original script name selection differs from source proof')
            # An actual original empty string field supplies the output ABI.
            scratch = n.observe_actor_fields(name_hash('SpellObject'), [])
            output = scratch['object']+0x48
            if native_string(n, output) != '':
                raise ValueError('Original output string constructor default differs')
            n.call(0x1e8740, {})
            extension = n.u.reg_read(r.UC_X86_REG_RAX)+1
            n.call(0x1499950, {r.UC_X86_REG_RDI: source})
            name_hash64 = n.u.reg_read(r.UC_X86_REG_RAX)
            needle = (name_hash64 << 5) & 0xffffffffffffffff
            packed_matches = ['%016x'%n.q(packed+index*8) for index in range(packed_count)
                              if n.q(packed+index*8)^needle <= 31]
            reached = []
            def before_archive(engine, address, size, user):
                path = native_string(n, engine.reg_read(r.UC_X86_REG_RSI))
                reached.append({'path': path, 'archiveReceiver': engine.reg_read(r.UC_X86_REG_RDI),
                                'callBoundaryRva': 0x147c480})
                engine.emu_stop()
            hook = n.u.hook_add(unicorn.UC_HOOK_CODE, before_archive,
                                begin=n.base+0x147c480, end=n.base+0x147c480)
            try:
                n.u.context_restore(n.initial)
                n.put(ADDRESSES['stack'], 'Q', ADDRESSES['stop'])
                n.u.reg_write(r.UC_X86_REG_RSP, ADDRESSES['stack'])
                for register, value in {r.UC_X86_REG_RDI: source, r.UC_X86_REG_RSI: shared,
                                        r.UC_X86_REG_RDX: extension, r.UC_X86_REG_RCX: output}.items():
                    n.u.reg_write(register, value)
                n.u.emu_start(n.base+0x85d790, ADDRESSES['stop'], count=5000000)
            finally:
                n.u.hook_del(hook)
            at = n.u.reg_read(r.UC_X86_REG_RIP)
            if len(reached) > 1 or at not in [n.base+0x147c480, ADDRESSES['stop']]:
                raise ValueError('Original script path query exceeded its exact archive/return boundary')
            returned = bool(n.u.reg_read(r.UC_X86_REG_RAX)&255) if at == ADDRESSES['stop'] else None
            constructed = native_string(n, output) if returned else None
            queries.append({'name': name, 'sourceSha256': item['sourceSha256'],
                            'ownerPathHash': item['ownerPathHash'], 'originalNameRead': source_read,
                            'nativeNameHashHex': '%016x'%name_hash64, 'matchingPackedValuesHex': packed_matches,
                            'candidate': reached[0] if reached else None,
                            'originalReturnedValue': returned, 'constructedPath': constructed,
                            'archiveExistenceObserved': False})
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'streamOffset': n.script_cursor}
    finally:
        n.script_input = None
    for file, expected in {**sources, **names['inputs']}.items():
        if sha(Path(file).read_bytes()) != expected:
            raise ValueError('Script registry source changed during controls: '+file)
    if ((args.input_root/'manifest.json').read_bytes() != manifest_bytes or data_path.read_bytes() != data or
            args.source_evidence.read_bytes() != evidence_bytes or args.name_input.read_bytes() != names_bytes):
        raise ValueError('Archived script input changed during native parsing')
    result = {'schema': 1, 'kind': 'original-archived-script-registry-observation',
              'build': manifest['build'], 'protocol': manifest['protocol'], 'decoderImageSha256': sha(n.image),
              'sourceAuthoritySha256': sha(manifest_bytes), 'sourceBytesSha256': sha(data),
              'sourceEvidenceSha256': sha(evidence_bytes), 'nameInputSha256': sha(names_bytes),
              'sources': sources, 'slices': slices, 'streamReads': n.script_reads,
              'registry': fields, 'pathQueries': queries, 'boundary': boundary,
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalManifestParsingExecuted': fields is not None, 'ownedArchivedByteStream': True,
                        'pathQueriesStoppedBeforeArchiveLookup': boundary is None,
                        'archiveExistenceEstablished': False, 'scriptsLoaded': False,
                        'runtimeSpellResourcesPublished': False, 'liveBuffProviderAdmitted': False}}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'parsedBytes': n.script_cursor,
                      'strings': len(fields['strings']) if fields else None,
                      'packedValues': len(fields['packedValuesHex']) if fields else None,
                      'pathQueries': queries, 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
