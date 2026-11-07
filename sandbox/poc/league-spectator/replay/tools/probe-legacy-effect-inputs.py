"""Compare native legacy particle input loading with the actual DATA archive.

A normal boolean return is recorded separately from INI file-open success and
populated runtime vectors. No particles, workers or GPU resources are spawned.
"""
import argparse
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from installed_resource_archive_native import register_resource_archive
from legacy_effect_native import NativeLegacyEffectInputs
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_object_native import NativeVfxObjects
from vfx_resource_native import NativeVfxResourceContext
from vfx_spawn_native import ADDRESSES,sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('installation',type=Path)
    p.add_argument('--quality',type=int,choices=range(4),required=True)
    p.add_argument('--graphics34b',type=int,choices=[0,1],required=True)
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeLegacyEffectInputs)
    n = fixture.native
    vm = n.initialize_character_script_vm()
    components = n.initialize_effect_preload_components(args.quality,bool(args.graphics34b))
    archive = register_resource_archive(fixture,args.installation,'DATA.wad.client')
    reads,frames = [],{}
    def opened(uc,address,size,user):
        name = uc.reg_read(r.UC_X86_REG_RSI)
        pointer,count = n.q(name),n.u32(name+8)
        if count > 4096 or not n.library_pointer(pointer,count):
            raise ValueError('Legacy input name escaped its owned string')
        record = {'path':bytes(uc.mem_read(pointer,count)).decode('utf-8'),'opened':None}
        reads.append(record)
        frames[uc.reg_read(r.UC_X86_REG_RSP)] = record
    def finished(uc,address,size,user):
        # This hook is in the caller immediately after CALL. Its RSP is eight
        # bytes above the callee entry's return-address slot.
        record = frames.pop(uc.reg_read(r.UC_X86_REG_RSP)-8,None)
        value = uc.reg_read(r.UC_X86_REG_RAX)&255
        if record is None or value not in [0,1]:
            raise ValueError('Legacy input open escaped its frame/boolean contract')
        record['opened'] = bool(value)
    # Original INI wrapper calls 1479d20 and observes its boolean at 14328a0.
    n.u.hook_add(unicorn.UC_HOOK_CODE,opened,begin=n.base+0x1479d20,end=n.base+0x1479d20)
    n.u.hook_add(unicorn.UC_HOOK_CODE,finished,begin=n.base+0x14328a0,end=n.base+0x14328a0)
    n.u.ctl_remove_cache(n.base+0x1432820,n.base+0x1432cf0)
    n.u.ctl_remove_cache(n.base+0x1479d20,n.base+0x1479e00)
    cases,boundary = [],None
    def load_definition(owner,name,definition):
        # Complex legacy systems exceed the small constructor probe's single
        # instruction slice. Continue the same original call, requiring parser
        # service progress in every unfinished slice; never restart its frame.
        n.u.context_restore(n.initial)
        n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        n.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack'])
        for register,value in {r.UC_X86_REG_RDI:owner,r.UC_X86_REG_RSI:name,
                               r.UC_X86_REG_RDX:definition,r.UC_X86_REG_RCX:definition+0x50,r.UC_X86_REG_R8:0}.items():
            n.u.reg_write(register,value)
        start,progress = n.base+0x16e9c60,[]
        for _ in range(16):
            before = (len(n.character_format_calls),len(n.legacy_platform_calls))
            n.u.emu_start(start,ADDRESSES['stop'],count=5000000)
            start = n.u.reg_read(r.UC_X86_REG_RIP)
            after = (len(n.character_format_calls),len(n.legacy_platform_calls))
            progress.append({'formatCalls':after[0]-before[0],'platformCalls':after[1]-before[1]})
            if start == ADDRESSES['stop']:
                return {'sliceInstructionBound':5000000,'slices':len(progress),'parserServiceProgress':progress}
            if after == before:
                raise ValueError('Legacy definition reader exhausted a slice without observed parser progress')
        raise ValueError('Legacy definition reader exceeded sixteen bounded instruction slices')
    try:
        for path in ['DATA/Shared/Particles/Items/3143_DamageReduction.troy',
                     'DATA/Particles/Ward_Sight_Idle.troy',
                     'DATA/Particles/__scout_missing_input_control__.troy']:
            definition = n.allocate(0x160)
            n.u.mem_write(definition,bytes(0x160))
            n.call(0x1779b60,{r.UC_X86_REG_RDI:definition})
            name,owner = n.allocate(16),n.allocate(8)
            n.put(owner,'Q',0)
            n.call(0x14c2d60,{r.UC_X86_REG_RDI:name,r.UC_X86_REG_RSI:n.allocate_text(path)})
            case = {'path':path,'definition':definition,'fileReadsStart':len(reads),'completed':False}
            cases.append(case)
            case['execution'] = load_definition(owner,name,definition)
            value = n.u.reg_read(r.UC_X86_REG_RAX)&255
            if value not in [0,1] or n.q(owner):
                raise ValueError('Original legacy load escaped its return/owner contract')
            vectors = [{'offset':offset,'pointer':n.q(definition+offset),
                        'count':n.u32(definition+offset+8),'capacityRaw':n.u32(definition+offset+12)}
                       for offset in [0x10,0x20,0x30,0x40]]
            case.update(completed=True,originalReturn=bool(value),fileReads=reads[case['fileReadsStart']:],
                        runtimeVectors=vectors,definitionHex=bytes(n.u.mem_read(definition,0x160)).hex(),
                        emitterSemanticsVerified=False,playbackVerified=False)
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper()))
                                 for key in ['rax','rbx','rdi','rsi','rdx','rcx','r8','r9','rbp','rsp']}}
    finally:
        n.close_files()
    # Inspect partial owned state without resuming a failed original call.
    for case in cases:
        if not case['completed']:
            case['fileReads'] = reads[case['fileReadsStart']:]
            case['definitionHex'] = bytes(n.u.mem_read(case['definition'],0x160)).hex()
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
             Path(__file__).with_name('installed_resource_archive_native.py'),
             Path(inspect.getfile(NativeVfxObjects)),Path(inspect.getfile(NativeVfxResourceContext)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-legacy-particle-input-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'inputs':fixture.inputs,
              'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'scriptVm':vm,'effectComponents':components,'installedArchive':archive,
              'cases':cases,'fileReads':reads,'fileCalls':n.file_calls,'fileLookups':n.file_lookups,
              'platformCalls':n.legacy_platform_calls,
              'formatCalls':n.character_format_calls,
              'threadExitCallbacks':n.legacy_thread_exit_callbacks,
              'boundary':boundary,'scope':{'originalLegacyLoaderExecuted':True,'assetReadinessVerified':False,
                                         'particlesSpawned':False,'worldBindingsVerified':False,
                                         'fullThreadShutdownExecuted':False,'mainViewerExpanded':False}}
    output = fixture.cache/'research/legacy-effect-inputs-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':[{key:case.get(key) for key in
                      ['path','completed','originalReturn','fileReads','runtimeVectors']} for case in cases],
                      'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()
