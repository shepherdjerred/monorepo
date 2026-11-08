"""Load matching map mode data/constants with original typed constructors.

Reference fixups and global post-load are not implied by complete field reads.
"""
import argparse
import importlib.metadata
import inspect
import io
import json
from pathlib import Path
import runpy
from unicorn import x86_const as r
from game_mode_data_native import NativeGameModeData
from vfx_asset_native import REGISTRY
from vfx_spawn_native import sha
from vfx_spawn_native import ADDRESSES


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('--probe-unit',action='store_true')
    args = p.parse_args()
    cache = args.cache.resolve()
    root = Path(__file__).resolve().parents[1]
    inputs = {}

    def raw(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = sha(data)
        return data

    def read(path):
        return json.loads(raw(path))

    startup = read(cache/'research/startup-config-comparison.json')
    if startup['mismatchCount'] or len(startup['results']) != 1:
        raise ValueError('One compared recorded startup configuration required')
    for path,digest in startup['inputs'].items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Startup evidence changed: '+path)
    for path,digest in startup['sources'].items():
        if sha((root/path).read_bytes()) != digest:
            raise ValueError('Startup source changed: '+path)
    installed = read(cache/'public/latest-map-effect-inputs/package.json')
    data = raw(cache/'public/latest-map-effect-inputs/map.bin')
    if sha(data) != installed['source']['sha256'] or installed['mapId'] != startup['results'][0]['configuredMapId']:
        raise ValueError('Matching map bytes/configuration required')
    if json.loads(importlib.metadata.distribution('cdtb').read_text('direct_url.json'))['vcs_info']['commit_id'] != '3367589fdd3ee3d0d01383d2f98dba12b04d1371':
        raise ValueError('Pinned typed BIN parser required')
    import cdtb.binfile as binfile
    names = runpy.run_path(str(Path(__file__).with_name('parse-latest-assets.py')))['names']
    for dictionary,name in [(binfile.hashfile_binfields,'binfields'),(binfile.hashfile_bintypes,'bintypes')]:
        path = cache/'vfx'/('hashes.'+name+'.txt')
        if sha(raw(path)) != installed['parser']['dictionaries'][name]['sha256']:
            raise ValueError('Pinned mode data dictionary required')
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

    stream = io.BytesIO(data)
    if stream.read(4) != b'PROP':
        raise ValueError('Original unpatched map BIN required')
    parser = Reader(stream)
    _,_,types = parser.read_binfile_header()
    entries = {entry.path.h:entry for entry in [parser.read_binfile_entry(t) for t in types]}
    n = NativeGameModeData(cache/'public/decoder-16.21-macos',args.client)
    if installed['decoderImageSha256'] != sha(n.image):
        raise ValueError('Matching game mode image required')
    modes = [entry for entry in entries.values() if entry.type.h == 0x89ce9636]
    selected = [entry for entry in modes if entry['mModeName'].value.h == startup['results'][0]['modeHash']]
    if len(selected) != 1:
        raise ValueError('Recorded mode does not select exactly one authored GameModeMapData')
    cases = []
    wanted = list(modes)
    for mode in modes:
        identity = mode['mGameModeConstants'].value.h
        if identity not in entries:
            raise ValueError('Game mode constants are external to prepared map BIN')
        if entries[identity] not in wanted:
            wanted.append(entries[identity])
    for entry in wanted:
        spans = [parser.spans[id(field)] for field in entry.fields]
        loaded = n.read_typed_fields(entry.type.h,[data[a:b] for a,b in spans])
        if entry.type.h == 0x89ce9636 and n.u32(loaded['object']+8) != entry['mModeName'].value.h:
            raise ValueError('Original typed mode name differs from authored BIN')
        cases.append({'identity':entry.path.h,'typeHash':entry.type.h,'selectedRecordedMode':entry is selected[0],
                      'fields':[{'offset':a,'bytes':b-a,'sha256':sha(data[a:b])} for a,b in spans],
                      'loaded':loaded})
    selected_case = next(case for case in cases if case['selectedRecordedMode'])
    provider = selected_case['loaded']['object']
    vtable = n.q(provider)
    index,unit_probe,time_probe,spell_statics,handler_probe = None,None,None,None,None
    if args.probe_unit:
        constants_id = selected[0]['mGameModeConstants'].value.h
        constants = next(case for case in cases if case['identity'] == constants_id)
        index = n.build_constant_index(selected_case['loaded'],constants,startup['results'][0]['modeHash'])
        values = []
        for identifier in [0x41,0x4a]:
            n.call(0x40ab50,{r.UC_X86_REG_RDI:provider,r.UC_X86_REG_RSI:identifier,r.UC_X86_REG_XMM0:0})
            values.append({'index':identifier,'keyHash':n.u32(n.base+0x2561d20+identifier*4),
                           'floatBits':n.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff})
        index['floatGetterProbes'] = values
        spell_statics = n.initialize_spell_statics()
        n.clock_inputs = {'numer':1,'denom':1,'ticks':0}
        time_root = n.allocate(0x60)
        try:
            n.call(0x15edc30,{r.UC_X86_REG_RDI:time_root})
            time_probe = {'object':time_root,'completed':True,'error':None}
        except Exception as exception:
            time_probe = {'object':time_root,'completed':False,'error':{'kind':type(exception).__name__,'message':str(exception),
                          'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}}
        unit = n.allocate(0x4100)
        n.u.mem_write(unit+0x4000,bytes([0xa5])*0x100)
        try:
            if not time_probe['completed']:
                raise ValueError('AI constructor not run against an incomplete time subsystem')
            n.call(0xbc980,{r.UC_X86_REG_RDI:unit})
            if (n.q(unit)-n.base != 0x22ec2d0 or n.q(unit+0xb28)-n.base != 0x22ed708 or
                    n.q(unit+0x35e0+0x128) != unit+0xb28 or
                    any(n.q(unit+0x35e0+offset) for offset in [0,8,16]) or
                    bytes(n.u.mem_read(unit+0x4000,0x100)) != bytes([0xa5])*0x100):
                raise ValueError('Original full AI-base constructor layout/ownership differs')
            unit_probe = {'unit':unit,'completed':True,'error':None,
                          'primaryVtableRva':n.q(unit)-n.base,'appearanceVtableRva':n.q(unit+0xb28)-n.base,
                          'appearanceStack':unit+0x35e0,'appearanceInput':n.stack_input(unit+0x35e0),
                          'allocationBytes':0x4000,'guardBytesUnchanged':0x100}
        except Exception as exception:
            unit_probe = {'unit':unit,'completed':False,'error':{'kind':type(exception).__name__,'message':str(exception),
                          'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}}
        if unit_probe['completed']:
            corpus = read(cache/'research/structural-corpus.json')
            observations = read(cache/'research/structural-corpus-native.json')
            arguments = read(cache/'research/appearance-stack-inputs-native.json')
            for path,digest in arguments['inputs'].items():
                if sha(Path(path).read_bytes()) != digest:
                    raise ValueError('Appearance argument input changed: '+path)
            for path,digest in arguments['sources'].items():
                if sha((Path(__file__).parent/path).read_bytes()) != digest:
                    raise ValueError('Appearance argument producer changed: '+path)
            selected_input = next(record for record in arguments['records'] if record['opcode'] == 984 and
                                  record['entityId'] == 1073741887)
            key = selected_input['key']
            packet,observation = corpus['packets'][key],observations['observations'][key]
            if (observations['decoderImageSha256'] != sha(n.image) or observation['status'] != 'complete' or
                    observation['payloadSha256'] != sha(bytes.fromhex(packet['payloadHex'])) or
                    arguments['build'] != n.profile['clientVersion']):
                raise ValueError('Matching original appearance message required')
            n.u.mem_write(0x10200000,bytes.fromhex(observation['heap']))
            # Follow the real virtual handler into the original unit prelude and
            # push storage. The stop is inside its callee, before projection.
            n.u.context_restore(n.initial)
            n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
            for register,value in {r.UC_X86_REG_RSP:ADDRESSES['stack'],r.UC_X86_REG_RDI:unit,
                                   r.UC_X86_REG_RSI:0x10200000}.items():
                n.u.reg_write(register,value)
            n.u.ctl_remove_cache(n.base+0x667f1,n.base+0xf7700)
            n.u.emu_start(n.base+0xf7700,n.base+0x667f1,count=5000000)
            if n.u.reg_read(r.UC_X86_REG_RIP) != n.base+0x667f1:
                raise ValueError('Original AI-unit appearance handler escaped projection boundary')
            supplied = n.stack_input(unit+0x35e0)
            if len(supplied['entries']) != 1:
                raise ValueError('Original AI-unit appearance handler did not insert one entry')
            entry = supplied['entries'][0]
            stored_entry = n.q(unit+0x35e0+8)-0xa0
            if (entry['key']['name'] != selected_input['strings']['character'] or
                    entry['key']['namespace'] != selected_input['strings']['namespace'] or
                    entry['key']['skinId'] != selected_input['skinId'] or entry['gearIndex'] != selected_input['gearIndex'] or
                    entry['flags'] != [selected_input[name] for name in ['flagR8','flagR9','flagStack0','flagStack2','flagStack3']] or
                    n.u32(stored_entry+0x80) != selected_input['entryId'] or
                    n.u32(stored_entry+0x98) != selected_input['overrideMask'] or
                    bytes(n.u.mem_read(unit+0x4000,0x100)) != bytes([0xa5])*0x100):
                raise ValueError('Original full-unit handler stored another appearance')
            handler_probe = {'packetKey':key,'recordedEntityId':packet['param'],'recordedTime':packet['time'],
                             'suppliedRoutingUnit':unit,'handlerRva':0xf7700,'stopRva':0x667f1,'stored':supplied,
                             'originalVirtualUnitPreludeExecuted':True,'resourceProjectionExecuted':False,
                             'liveWorldRouteVerified':False}
    paths = {Path(__file__),Path(__file__).with_name('parse-latest-assets.py'),
             *[Path(inspect.getfile(c)) for c in NativeGameModeData.__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-game-mode-data-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'inputs':inputs,
              'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'cases':cases,'selectedMode':startup['results'][0],
              'selectedIdentity':selected_case['identity'],'providerVtableRva':vtable-n.base,
              'constantIndex':index,'unitProbe':unit_probe,'timeProbe':time_probe,
              'spellStatics':spell_statics,
              'appearanceHandlerProbe':handler_probe,
              'platformClock':{'inputs':n.clock_inputs,'calls':n.clock_calls,
                               'recordedFrameScheduleRecovered':False},
              'snapshot':{'heapAddress':0x10400000,
                          'nextHeap':n.next_heap,'allocations':n.allocations,'mutexes':n.mutexes,
                          'heapHex':bytes(n.u.mem_read(0x10400000,n.next_heap-0x10400000)).hex(),
                          'imagePatches':[{'rva':at,'bytesHex':bytes(n.u.mem_read(n.base+at,4096)).hex()}
                              for at in range(0x1fef000,len(n.image),4096)
                              if bytes(n.u.mem_read(n.base+at,4096)) != n.image[at:at+4096]]},
              'providerVirtual20Rva':n.q(vtable+0x20)-n.base,
              'typeDescriptors':{str(identity):{'rva':descriptor-n.base,'size':n.q(descriptor+0x40),
                                               'constructorRva':n.q(descriptor+0x20)-n.base}
                                 for identity,descriptor in n.types.items()},
              'counts':{'registeredTypes':len(n.types),'modeRoots':len(modes),'loadedRoots':len(cases),
                        'finalRegistryTypes':n.u32(n.base+REGISTRY+8),
                        'fields':sum(len(case['fields']) for case in cases),
                        'pendingReferences':sum(len(case['loaded']['pendingReferences']) for case in cases)},
              'scope':{'originalTypeInitializerExecuted':True,'originalConstructorsAndTypedReadersExecuted':True,
                       'actualRecordedModeSelected':True,'referenceLinksFixed':False,'globalPostloadExecuted':False,
                       'constantsReferenceFixed':index is not None,'originalConstantIndexBuilt':index is not None,
                       'originalProviderGlobalPrefixExecuted':index is not None,
                       'readyGlobalProviderEstablished':False,'suppliedPlatformClockInputs':n.clock_inputs is not None,
                       'fullAiUnitConstructorCompleted':bool(unit_probe and unit_probe['completed']),
                       'originalAppearanceUnitPreludeExecuted':handler_probe is not None,
                       'liveHeroConstructed':False,'liveAppearanceStateRecovered':False,
                       'usableLiveUnitEstablished':False,'mainViewerExpanded':False}}
    (cache/'research/game-mode-data-native.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'selectedIdentity':hex(result['selectedIdentity']),'virtual20':hex(result['providerVirtual20Rva']),
                      'counts':result['counts'],'aiBaseConstructorCompleted':result['scope']['fullAiUnitConstructorCompleted']}))


if __name__ == '__main__':
    main()
