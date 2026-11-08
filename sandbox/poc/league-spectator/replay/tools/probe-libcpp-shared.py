"""Control libc++ ownership imports with original game control-block code."""
import argparse
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from game_mode_data_native import NativeGameModeData
from libcpp_shared_native import NativeLibcppSharedOwnership
from world_descriptor_native import NativeWorldDescriptors
from vfx_spawn_native import sha,ADDRESSES


class NativeOwnership(NativeLibcppSharedOwnership,NativeGameModeData):pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path);args=parser.parse_args()
    fixture=NativeAIUnitFixture(args.cache,args.client,NativeOwnership);n=fixture.native
    sources_dir=fixture.cache/'research/emsdk/upstream/emscripten/system/lib/libcxx'
    for file in [sources_dir/'src/memory.cpp',sources_dir/'include/__memory/shared_count.h']:fixture.raw(file)
    destructors=[]
    n.u.hook_add(unicorn.UC_HOOK_CODE,lambda engine,at,size,user:destructors.append(engine.reg_read(r.UC_X86_REG_RDI)),
                 begin=n.base+0x15c2f70,end=n.base+0x15c2f70)
    def create(shared,weak):
        parent=n.allocate(0x28);pointee=n.allocate(8)
        # Actual control-block allocation, zero counters, vtable and pointee
        # construction from the animation node's constructor.
        n.call(0x159de20,{r.UC_X86_REG_RBX:parent,r.UC_X86_REG_R14:pointee},0x159de43)
        control=n.q(parent+0x20)
        if (n.allocations.get(control)!=0x20 or n.q(control)!=n.base+0x23e5230 or
                n.q(control+0x20-8)!=pointee or n.q(n.q(control)+0x20)!=n.base+0x15c2f70):
            raise ValueError('Original libc++ control block/final weak destructor layout differs')
        # Explicit platform ownership states, not supplied game readiness.
        n.put(control+8,'qq',shared,weak)
        return control
    cases=[]
    for name,shared,weak,entry,expected_shared,expected_weak,expected_result in [
            ('lock-live',0,1,0x1fee4ec,1,1,True),('lock-expired',-1,0,0x1fee4ec,-1,0,False),
            ('retain-weak',-1,2,0x1fee4e6,-1,1,None),('final-weak',-1,0,0x1fee4e6,-1,0,None)]:
        control=create(shared,weak);before=len(destructors)
        n.call(entry,{r.UC_X86_REG_RDI:control})
        if n.q(control+8)!=(expected_shared&0xffffffffffffffff) or n.q(control+16)!=expected_weak:
            raise ValueError('Libc++ ownership counter result differs: '+name)
        if expected_result is not None and n.u.reg_read(r.UC_X86_REG_RAX)!=(control if expected_result else 0):
            raise ValueError('Libc++ weak lock result differs: '+name)
        if len(destructors)-before!=(1 if name=='final-weak' else 0):
            raise ValueError('Original final weak destructor dispatch differs: '+name)
        cases.append({'name':name,'control':control,'passed':True,'originalDestructorReturned':name=='final-weak'})
        if name=='final-weak':
            try:n.call(entry,{r.UC_X86_REG_RDI:control})
            except ValueError as error:
                if str(error)!='Libc++ ownership requires a live owned control block':raise
            else:raise ValueError('Retired libc++ control block was accepted')
            cases.append({'name':'retired-control-rejected','passed':True})
    control=create(-1,-1)
    try:n.call(0x1fee4e6,{r.UC_X86_REG_RDI:control})
    except ValueError as error:
        if str(error)!='Libc++ ownership counter exceeds admitted bounds':raise
    else:raise ValueError('Released weak count was accepted')
    cases.append({'name':'released-counter-rejected','passed':True})
    # Exercise the older descriptor composition's ownership boundary too. Its
    # final weak branch must select the same original deallocator, rather than
    # the adjacent get_deleter slot.
    control=create(-1,0);n.u.context_restore(n.initial)
    n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
    n.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack']);n.u.reg_write(r.UC_X86_REG_RDI,control)
    before=len(destructors)
    NativeWorldDescriptors.imported(n,n.u,n.base+0x1fee4e6,6,None)
    if n.u.reg_read(r.UC_X86_REG_RIP)!=n.base+0x15c2f70:
        raise ValueError('Descriptor composition selected another final weak destructor')
    n.u.emu_start(n.base+0x15c2f70,ADDRESSES['stop'],count=100000)
    if n.u.reg_read(r.UC_X86_REG_RIP)!=ADDRESSES['stop'] or len(destructors)!=before+1:
        raise ValueError('Descriptor original final weak destructor did not return')
    cases.append({'name':'descriptor-final-weak','passed':True,'originalDestructorReturned':True})
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
           Path(inspect.getfile(NativeWorldDescriptors)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result={'schema':1,'kind':'libcpp-shared-ownership-abi-control','build':n.profile['clientVersion'],
            'inputs':fixture.inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(paths)},
            'decoderImageSha256':sha(n.image),'originalBlocks':list(n.blocks.values()),
            'cases':cases,'sharedCalls':n.shared_calls,'originalDestructorEntries':destructors,
            'scope':{'platformAbiOnly':True,'originalFinalWeakDestructorExecuted':True,
                     'arenaStorageReclaimed':False,'multithreadedOwnershipVerified':False,'mainViewerExpanded':False}}
    output=fixture.cache/'research/libcpp-shared-native.json';output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'originalDestructorCalls':len(destructors)}))


if __name__=='__main__':main()
