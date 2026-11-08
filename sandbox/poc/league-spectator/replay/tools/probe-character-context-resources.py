"""Original character resource names and typed resolver binding over static BIN.

The installed HealthRelic resolver is read by the original typed reader. The
asset-query cell and context publication are explicit controls, not startup
history, asset readiness, accepted replay state or rendering evidence.
"""
import argparse
import importlib.metadata
import inspect
import io
import json
from pathlib import Path
import sys

from unicorn import x86_const as r
from effect_context_native import NativeEffectContexts, FRAME
from character_postload_native import NativeCharacterPostload
from resource_publication_trace_native import install_resource_publication_trace
from vfx_spawn_native import sha


class Control(NativeCharacterPostload):
    original_string = NativeEffectContexts.original_string
    character_context = NativeEffectContexts.character_context
    registry = NativeEffectContexts.registry
    register_context = NativeEffectContexts.register_context
    lookup_context = NativeEffectContexts.lookup_context


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    inputs = {}

    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Input changed: ' + str(path))
        inputs[str(path)] = digest
        return data

    tools = Path(__file__).resolve().parent
    paths = {Path(__file__).resolve(), args.client.resolve(),
             cache/'public/decoder-16.21-macos/profile.json', cache/'public/decoder-16.21-macos/image.bin'}
    paths.update(Path(inspect.getfile(c)).resolve() for c in Control.__mro__ if c is not object)
    paths.update(Path(m.__file__).resolve() for m in tuple(sys.modules.values())
                 if getattr(m,'__file__',None) and Path(m.__file__).suffix=='.py'
                 and Path(m.__file__).resolve().is_relative_to(tools))
    for path in paths: raw(path)

    manifest = json.loads(raw(cache/'research/health-relic-context-inputs/manifest.json'))
    for path, digest in manifest['inputs'].items():
        if sha(raw(path)) != digest:
            raise ValueError('Static HealthRelic input changed: ' + path)
    n = Control(cache/'public/decoder-16.21-macos', args.client)
    trace = install_resource_publication_trace(n)
    n.initialize_character_types()
    n.call(0x35dd5c, {}, 0x35dd6e)
    registry = n.registry()
    cases = []
    for name, skin, namespace in [('HA_AP_HealthRelic', 0, 'characters'),
                                  ('Example_Resource', 0, 'characters'),
                                  ('Example_Resource', 12, 'units'),
                                  ('Example_Resource', 0xffffffff, 'characters')]:
        context = n.character_context(name, skin, namespace)
        # Original format/hash fragment; the data query itself is not replaced.
        n.u.mem_write(FRAME-0x500, bytes(0x500))
        n.fragment(0x3526a6, 0x35271f, {
            r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_RBX: context['object'],
            r.UC_X86_REG_R12: 0x10000000000})
        resource_name = n.cstring(n.q(FRAME-0x378)).decode('ascii')
        resource_identity = n.u32(FRAME-0x3e8)
        candidates = None
        if skin == 0:
            candidates = []
            for start, end in [(0x35258a, 0x3525e3), (0x352653, 0x35268f)]:
                n.u.mem_write(FRAME-0x500, bytes(0x500))
                n.fragment(start, end, {r.UC_X86_REG_RBP: FRAME,
                    r.UC_X86_REG_RBX: context['object'],
                    r.UC_X86_REG_R12: 0x10000000000})
                candidates.append(n.cstring(n.q(FRAME-0x148)).decode('ascii'))
        cases.append({'name': name, 'skinId': skin, 'namespace': namespace,
                      'contextIdentity': context['identity'], 'resourceName': resource_name,
                      'resourceIdentity': resource_identity, 'fileCandidates': candidates})

    import cdtb.binfile as binfile
    parser_package = json.loads(raw(cache/'public/latest-map-effect-inputs/package.json'))
    installed_parser = json.loads(importlib.metadata.distribution('cdtb').read_text('direct_url.json'))
    if installed_parser['vcs_info']['commit_id'] != parser_package['parser']['cdtbRevision']:
        raise ValueError('Pinned static BIN parser required')
    for dictionary in [binfile.hashfile_binfields, binfile.hashfile_bintypes,
                       binfile.hashfile_binentries, binfile.hashfile_binhashes,
                       binfile.hashfile_binhashes_xxh3, binfile.hashfile_binpaths]:
        dictionary.hashes = {}

    class Reader(binfile.BinReader):
        def __init__(self, *a):
            super().__init__(*a)
            self.spans = {}

        def read_field(self, htype):
            start = self.f.tell()
            field = super().read_field(htype)
            self.spans[id(field)] = (start, self.f.tell())
            return field

    job = next(job for job in manifest['jobs'] if job['path'].endswith('/skins/skin0.bin'))
    source = raw(Path(job['source']))
    if sha(source) != job['sha256'] or source[:4] != b'PROP':
        raise ValueError('Installed skin0 source differs')
    stream = io.BytesIO(source)
    stream.read(4)
    reader = Reader(stream)
    _, _, types = reader.read_binfile_header()
    entries = [reader.read_binfile_entry(t) for t in types]
    resolver_identity = int(manifest['resourceResolverId'].strip('{}'), 16)
    entry = next(e for e in entries if e.path.h == resolver_identity)
    if entry.type.h != 0xef3a0f33 or resolver_identity != cases[0]['resourceIdentity']:
        raise ValueError('Original resource name does not address exact typed skin resolver')
    fields = [source[a:b] for a, b in [reader.spans[id(f)] for f in entry.fields]]
    loaded = n.observe_actor_fields(entry.type.h, fields)
    if loaded['originalSkippedFields']:
        raise ValueError('Original resolver reader skipped authored fields')
    resolver = loaded['object']
    pointer, count = n.q(resolver+8), n.u32(resolver+0x10)
    rows = [{'key':n.u32(pointer+i*16), 'referenceToken':n.q(pointer+i*16+8)} for i in range(count)]
    if [row['key'] for row in rows] != manifest['authoredResourceKeys']:
        raise ValueError('Original resolver rows differ from exact installed input')
    context = n.character_context(manifest['characterName'], 0)
    cell = n.allocate(16)
    wrong = n.observe_actor_fields(0x23ea1915, [])['object']
    bindings = []
    # Complete original type acceptance, the null path, and loaded getter.
    for label, address, descriptor in [('typed-resolver', resolver, n.types[0xef3a0f33]),
                                      ('wrong-type', wrong, n.types[0x23ea1915]),
                                      ('absent', 0, 0)]:
        if label == 'absent':
            n.fragment(0x35275d, 0x352767, {r.UC_X86_REG_RBX:context['object']})
        else:
            n.put(cell, 'QQ', address, descriptor)
            n.fragment(0x352741, 0x352767, {
                r.UC_X86_REG_RAX:cell, r.UC_X86_REG_RBX:context['object']})
        expected = resolver if label == 'typed-resolver' else 0
        if n.q(context['object']+0x60) != expected or bytes(n.u.mem_read(context['object']+0x68,1)) != b'\1':
            raise ValueError('Original typed context resolver assignment differs: '+repr({
                'label':label,'expected':expected,'actual':n.q(context['object']+0x60),
                'loadByte':bytes(n.u.mem_read(context['object']+0x68,1)).hex()}))
        n.call(0x353f70, {r.UC_X86_REG_RDI:context['object']})
        if n.u.reg_read(r.UC_X86_REG_RAX) != expected:
            raise ValueError('Original loaded context getter differs')
        bindings.append({'label':label, 'found':label != 'absent',
                         'typeHash':None if label == 'absent' else (0xef3a0f33 if label=='typed-resolver' else 0x23ea1915),
                         'accepted':bool(expected), 'getterRva':0x353f70,
                         'loadAttemptCompleted':True,
                         'rows':rows if expected else []})
    # Publish the actual supplied loaded context with the same original setter.
    n.put(cell, 'QQ', resolver, n.types[0xef3a0f33])
    n.fragment(0x352741, 0x352767, {r.UC_X86_REG_RAX:cell, r.UC_X86_REG_RBX:context['object']})
    n.register_context(registry, context['object'])
    if n.lookup_context(registry, context['identity']) != context['object']:
        raise ValueError('Original supplied loaded-context publication differs')
    # The bounded registration helper stops exactly at353c3e. Execute its next
    # original LEA so the read-only post-store hook is controlled too, without
    # entering the later unrelated notification list.
    node=n.q(registry+0x58)
    for unused in range(128):
        if not node:raise ValueError('Published context node is absent')
        identity=n.u32(node+0x20)
        if identity==context['identity']:break
        node=n.q(node+(0 if context['identity']<identity else 8))
    else:raise ValueError('Published context tree exceeded control bound')
    n.fragment(0x353c3e,0x353c45,{r.UC_X86_REG_R14:context['object'],
        r.UC_X86_REG_RBX:node,r.UC_X86_REG_R15:registry,r.UC_X86_REG_RBP:FRAME})
    if (len(trace.events)!=1 or trace.events[0]['identity']!=context['identity'] or
            trace.events[0]['resolver']!=resolver or trace.events[0]['loadAttemptByte']!=1):
        raise ValueError('Read-only actual post-store trace differs')
    missing = [n.lookup_resource(resolver, key) for key in manifest['absentRequestedKeys']]
    if any(item['found'] for item in missing):
        raise ValueError('Recorded Kiwi keys unexpectedly exist in HealthRelic resolver')
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:raise ValueError('Input changed: '+path)
    result = {'schema':1,'kind':'original-character-context-resource-controls',
              'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
              'decoderImageSha256':sha(n.image),'inputs':inputs,'cases':cases,'bindings':bindings,
              'loadedResourceIdentity':resolver_identity, 'rows':rows,
              'publicationTrace':trace.snapshot(),
              'requestedMissingKeys':manifest['absentRequestedKeys'],
              'originalBlocks':list(n.blocks.values()),
              'scope':{'originalTypedInstalledResolverReader':True,
                       'originalLoadedGetterAndSuppliedPublication':True,
                       'actualStartupRegistryPublicationRecovered':False,
                       'assetReadinessRecovered':False,'vfxReferenceTokensLinked':False,
                       'globalResourceHistoryRecovered':False,'actualEffectsActivated':False}}
    output=cache/'research/character-context-resources-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'bindings':len(bindings),
                      'rows':len(rows),'absentRequests':len(missing)}))


if __name__ == '__main__':main()
