"""Prove the empty-metadata skin selection case for exact archived Map11.

Original typed metadata constructors, runtime selector construction/copy and
selection branches execute. Empty remap/offset tables and the native Default
MapSkin's empty fallback table make mode/team predicates irrelevant. Their
providers and the complete resource resolver/factory are not reconstructed.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from vfx_spawn_native import sha, name_hash
from neutral_argument_corpus import load_neutral_argument_proof, SCHEMA_PATH

FRAME = 0x100f5000


def checked_sources(proof):
    for file, digest in proof['sources'].items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Original proof source changed: '+file)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'input', 'arguments', 'variant', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    input_bytes, arguments_bytes, variant_bytes = [file.read_bytes() for file in [args.input, args.arguments, args.variant]]
    request, arguments, variant = [json.loads(raw) for raw in [input_bytes, arguments_bytes, variant_bytes]]
    argument_input = load_neutral_argument_proof(args.arguments)
    root = Path(__file__).resolve().parent
    if (request['kind'] != 'original-native-skin-meta-field-input' or request['build'] != '16.21.829.8620' or
            request['protocol'] != '20e09df23c66b85e' or
            request['preparerSha256'] != sha((root/'prepare-native-skin-meta-input.mjs').read_bytes()) or
            request['readerSha256'] != sha((root/'exact-map-bin.mjs').read_bytes()) or
            request['manifest']['sha256'] != sha(Path(request['manifest']['file']).read_bytes()) or
            request['requestSha256'] != sha(arguments_bytes)):
        raise ValueError('Exact source-bound skin metadata input required')
    if (variant['boundary'] is not None or
            variant['sourceBinSha256'] != '97ce42d783534698c4ab852a6fccc1dccaeb795306bad9121ada2cacd958155e' or
            variant['context']['variant'] != 'Default' or variant['build'] != request['build'] or
            variant['protocol'] != request['protocol']):
        raise ValueError('Original recorded arguments and exact Default Map11 context required')
    checked_sources(variant)
    selected = variant['context']['selectedSkin']['identity']
    skins = [case for case in variant['cases'] if case['identity'] == selected and case['name'] == 'Default']
    if len(skins) != 1:
        raise ValueError('Unique original Default MapSkin observation required')
    skin = bytes.fromhex(skins[0]['loaded']['objectHex'])
    if len(skin) != 416 or struct.unpack_from('<Q', skin, 0x148)[0] or struct.unpack_from('<Q', skin, 0x158)[0]:
        raise ValueError('Default map fallback table is not the proven empty native map')
    n = NativeCharacterAssets(args.cache/'public/decoder-16.21-macos', args.client)
    paths = {Path(__file__), Path(inspect.getfile(load_neutral_argument_proof)), SCHEMA_PATH,
             *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in sorted(paths)}
    n.initialize_character_types()
    if sha(n.image) != argument_input['decoderImageSha256'] or sha(n.image) != variant['decoderImageSha256']:
        raise ValueError('Original image identity differs')
    requested = {(row['character'], row['skinId']) for row in argument_input['requests']}
    characters = {entry['character'].lower() for entry in request['roots']}
    if characters != {character for character, skin in requested}:
        raise ValueError('Original metadata does not cover every requested neutral character')
    cases, boundary, active = [], None, None
    try:
        for entry in request['roots']:
            active = {'character': entry['character']}
            data = Path(entry['source']['file']).read_bytes()
            if sha(data) != entry['source']['sha256'] or len(data) != entry['source']['bytes']:
                raise ValueError('Original metadata source changed')
            if entry['fields'] or entry['original'] or int(entry['typeHash'], 16) != name_hash('SkinCharacterMetaDataProperties'):
                raise ValueError('This proof admits only original empty SkinCharacterMetaDataProperties roots')
            metadata = n.observe_actor_fields(int(entry['typeHash'], 16), [])
            meta = metadata['object']
            if metadata['originalSkippedFields'] or metadata['pendingReferences'] or metadata['size'] != 0x50 or (
                    n.u32(meta+0x38) or n.u32(meta+0x48)):
                raise ValueError('Original metadata defaults contain remap/offset data')
            for character, requested_skin in sorted(requested):
                if character != entry['character'].lower():
                    continue
                selector = n.allocate(0x40)
                n.call(0x2feb62, {r.UC_X86_REG_RAX: selector}, 0x2feba0)
                if n.u32(selector+0x38) != 0x7fffffff or n.u32(selector+0x34):
                    raise ValueError('Original unlinked selector defaults differ')
                n.u.mem_write(FRAME-0x200, bytes(0x200))
                n.put(FRAME-0x15c, 'I', requested_skin)
                n.call(0x2f23c5, {r.UC_X86_REG_R14: meta, r.UC_X86_REG_R13: selector,
                                 r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_R15: 0}, 0x2f2556)
                if n.u32(selector+0x20) or n.u32(selector+0x34) or n.u32(selector+0x38) != 0x7fffffff:
                    raise ValueError('Original empty metadata copied a remap, offset or override')
                n.call(0x2f2634, {r.UC_X86_REG_RBX: selector}, 0x2f265b)
                base = n.u.reg_read(r.UC_X86_REG_R14D)
                results = []
                for start in [0x2f269d, 0x2f26c3]:
                    n.call(start, {r.UC_X86_REG_RBX: selector, r.UC_X86_REG_R14D: base}, 0x2f26c6)
                    results.append(n.u.reg_read(r.UC_X86_REG_EAX))
                if base != requested_skin or results != [requested_skin, requested_skin]:
                    raise ValueError('Original remaining mode branches changed the empty-table skin')
                cases.append({'character': character, 'requestedSkinId': requested_skin, 'resourceSkinId': base,
                              'metadata': metadata, 'selectorHex': bytes(n.u.mem_read(selector, 0x40)).hex(),
                              'remainingModeBranchResults': results})
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error), 'active': active,
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    ranges = [(0x689d20, 0x689d50), (0x2feb62, 0x2feba0), (0x2f23c5, 0x2f2556),
              (0x2f2611, 0x2f2634), (0x2f2634, 0x2f26c6)]
    for start, end in ranges:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original skin-selection source differs from pristine client')
    if sources != {str(path.resolve()): sha(path.read_bytes()) for path in sorted(paths)}:
        raise ValueError('Native skin selection source changed during controls')
    if load_neutral_argument_proof(args.arguments)['inputs'] != argument_input['inputs']:
        raise ValueError('Original argument inputs changed during native controls')
    if args.input.read_bytes() != input_bytes or args.variant.read_bytes() != variant_bytes:
        raise ValueError('Native selection inputs changed during controls')
    checked_sources(variant)
    result = {'schema': 1, 'kind': 'original-empty-skin-meta-selection', 'build': request['build'],
              'protocol': request['protocol'], 'decoderImageSha256': sha(n.image),
              'inputSha256': sha(input_bytes), 'argumentProofSha256': sha(arguments_bytes),
              'argumentSources': [{'sha256': source['sha256'], 'replaySha256': source['proof']['replaySha256']}
                                  for source in argument_input['proofs']],
              'defaultMapProofSha256': sha(variant_bytes), 'selectedMapSkin': 'Default', 'cases': cases, 'boundary': boundary,
              'sourceBlocks': [{'startRva': start, 'endRva': end, 'sha256': sha(n.image[start:end])} for start, end in ranges],
              'originalBlocks': list(n.blocks.values()),
              'sources': sources,
              'scope': {'originalTypedMetadataConstructed': boundary is None,
                        'originalSelectorConstructionCopySelectionFragmentsExecuted': boundary is None,
                        'defaultMapFallbackTableProvenEmpty': True,
                        'emptyRemapAndOffsetModeBranchInvariance': boundary is None,
                        'completeResourceResolverExecuted': False, 'actualModeFlagStateRecovered': False,
                        'dynamicMapVariantsAdmitted': False, 'factoryExecuted': False, 'nativeSpectatorEquivalent': False}}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'cases': len(cases), 'boundary': boundary,
                      'skins': [(case['character'], case['resourceSkinId']) for case in cases]}), flush=True)
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
