"""Load authored character/skin records with original typed constructors.

Serialized links stay pending. Complete field reads do not imply ready model,
animation, material, resource or renderer state.
"""
import argparse
import importlib.metadata
import inspect
import io
import json
from pathlib import Path
import runpy
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from game_mode_data_native import NativeGameModeData
from character_asset_native import NativeCharacterAssets
from vfx_object_native import NativeVfxObjects
from vfx_asset_native import REGISTRY
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('--actor',default='champions/viego/43')
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeCharacterAssets)
    n,cache = fixture.native,fixture.cache
    effects = fixture.read(cache/'public/latest-effects/manifest.json')
    package = fixture.read(cache/'public/latest-effects/package.json')
    if args.actor not in effects['actors'] or effects['build'] != n.profile['clientVersion']:
        raise ValueError('An exact prepared actor is required')
    if json.loads(importlib.metadata.distribution('cdtb').read_text('direct_url.json'))['vcs_info']['commit_id'] != effects['toolchain']['cdtbRevision']:
        raise ValueError('Pinned actor BIN parser required')
    import cdtb.binfile as binfile
    names = runpy.run_path(str(Path(__file__).with_name('parse-latest-assets.py')))['names']
    for dictionary,name in [(binfile.hashfile_binfields,'binfields'),(binfile.hashfile_bintypes,'bintypes')]:
        path = cache/'vfx'/('hashes.'+name+'.txt')
        if sha(fixture.raw(path)) != effects['toolchain']['dictionaries'][name]:
            raise ValueError('Pinned actor property dictionary required')
        dictionary.hashes = names(path)
    for dictionary in [binfile.hashfile_binentries,binfile.hashfile_binhashes,binfile.hashfile_binhashes_xxh3,binfile.hashfile_binpaths]:
        dictionary.hashes = {}

    class Reader(binfile.BinReader):
        def __init__(self,*args):
            super().__init__(*args)
            self.spans = {}

        def read_field(self,htype):
            start = self.f.tell()
            field = super().read_field(htype)
            self.spans[id(field)] = (start,self.f.tell())
            return field

    count = n.initialize_character_types()
    required = {}
    def collect_types(value):
        if isinstance(value,list):
            for child in value: collect_types(child)
        elif isinstance(value,dict):
            if '__type' in value:
                name = value['__type']
                if name.startswith('{') and name.endswith('}'):
                    identity = int(name[1:-1],16)
                else:
                    identity = 0x811c9dc5
                    for byte in name.lower().encode('utf-8'):
                        identity = ((identity ^ byte)*0x1000193) & 0xffffffff
                required[identity] = name
            for child in value.values(): collect_types(child)
    for source in package['actors'][args.actor]['sourceBins']:
        stem = source['sourceSha256']+'-'+effects['toolchain']['parserIdentity'][:16]
        encoded = fixture.raw(cache/'research/latest-effects/bins'/(stem+'.json'))
        if sha(encoded) != source['jsonSha256']:
            raise ValueError('Prepared actor JSON differs from pinned source metadata')
        for value in json.loads(encoded).values():
            if isinstance(value,dict) and value.get('__type') in ['CharacterRecord','SkinCharacterDataProperties']:
                collect_types(value)
    type_coverage = {'required':len(required),'missing':[{'hash':identity,'name':name}
                     for identity,name in sorted(required.items()) if identity not in n.types]}
    cases,missing = [],[]
    for source in package['actors'][args.actor]['sourceBins']:
        stem = source['sourceSha256']+'-'+effects['toolchain']['parserIdentity'][:16]
        data = fixture.raw(cache/'research/latest-effects/bins'/(stem+'.bin'))
        if sha(data) != source['sourceSha256'] or data[:4] != b'PROP':
            raise ValueError('Authored actor bytes differ')
        stream = io.BytesIO(data)
        stream.read(4)
        parser = Reader(stream)
        _,_,types = parser.read_binfile_header()
        entries = [parser.read_binfile_entry(t) for t in types]
        for entry in entries:
            if entry.type.h not in [0x23ea1915,0x9b67e9f6]:
                continue
            spans = [parser.spans[id(field)] for field in entry.fields]
            case = {'actorKey':args.actor,'source':source,'identity':entry.path.h,'typeHash':entry.type.h,
                    'fieldSpans':[{'offset':a,'bytes':b-a,'sha256':sha(data[a:b])} for a,b in spans]}
            try:
                case['loaded'] = n.observe_actor_fields(entry.type.h,[data[a:b] for a,b in spans])
                case['status'] = ('original-read-with-explicit-skips-links-pending' if case['loaded']['originalSkippedFields']
                                  else 'original-fields-loaded-links-pending')
            except Exception as exception:
                case.update(status='boundary',error={'kind':type(exception).__name__,'message':str(exception),
                            'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base},
                            originalSkippedFields=list(n.ignored),originalMismatchedFields=list(n.mismatched))
                cases.append(case)
                break
            cases.append(case)
        if cases and cases[-1]['status'] == 'boundary':
            break
    if not cases:
        raise ValueError('Prepared actor closure has no character or skin root')
    if n.object_attrs or any(value['depth'] for value in n.character_mutexes.values()):
        raise ValueError('Character field read left synchronization state owned')
    skipped_owners = {skip['ownerTypeHash'] for case in cases if 'loaded' in case for skip in case['loaded']['originalSkippedFields']}
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(__file__).with_name('parse-latest-assets.py'),
             Path(inspect.getfile(NativeVfxObjects)),
             *[Path(inspect.getfile(c)) for c in NativeCharacterAssets.__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-character-asset-input-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'actorKey':args.actor,
              'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'cases':cases,
              'typeCoverage':type_coverage,
              'skippedOwnerDescriptors':{str(identity):n.type_catalog[format(identity,'08x')] for identity in sorted(skipped_owners)},
              'synchronization':{'singleThreadOwnershipModel':True,'attributes':n.object_attrs,
                                 'mutexes':n.character_mutexes,'services':n.object_os_calls},
              'descriptors':{str(identity):n.type_catalog[format(identity,'08x')] for identity in [0x23ea1915,0x9b67e9f6]},
              'counts':{'registeredTypes':count,'roots':len(cases),
                        'completeFieldReads':sum(case['status'] == 'original-fields-loaded-links-pending' for case in cases),
                        'originalReadsWithExplicitSkips':sum(case['status'] == 'original-read-with-explicit-skips-links-pending' for case in cases),
                        'originalSkippedFields':sum(len(case['loaded']['originalSkippedFields']) for case in cases if 'loaded' in case),
                        'boundaries':sum(case['status'] == 'boundary' for case in cases)},
              'scope':{'originalConstructorsAndTypedReadersExecuted':True,'referenceLinksFixed':False,
                       'nativeFieldSkipsReportedExplicitly':True,
                       'fullAssetPostloadExecuted':False,'assetReadinessVerified':False,'unitCallbacksExecuted':False,
                       'mainViewerExpanded':False}}
    out = cache/'research'/('character-asset-inputs-'+args.actor.replace('/','-')+'-native.json')
    out.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(out),'counts':result['counts'],'typeCoverage':type_coverage,
                      'boundaries':[case['error'] for case in cases if 'error' in case]}))


if __name__ == '__main__':
    main()
