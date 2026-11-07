"""Execute the original library post-load stage on a supplied fixed graph.

The original stage installs/restores its two TLS cells and visits the supplied
root table in order. Whole asset loading, resource readiness and unit callbacks
remain outside this observation.
"""
import argparse
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from character_asset_native import NativeCharacterAssets
from character_postload_native import NativeCharacterPostload
from character_graph_snapshot import restore,capture
from vfx_spawn_native import ADDRESSES,sha

START,END = 0x14bb540,0x14bb5f6
LIBRARY_TLS,ENTRY_TLS = 0x24882c8,0x24882e0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('--actor',required=True)
    p.add_argument('--type',action='append',type=lambda value:int(value,16),dest='selected_types')
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeCharacterPostload)
    n,cache = fixture.native,fixture.cache
    stem = 'character-asset-links-'+args.actor.replace('/','-')
    reference_path = cache/'research'/(stem+'-native.json')
    reference = fixture.read(reference_path)
    if (reference['actorKey'] != args.actor or not reference['scope']['referenceLinksFixed'] or
            reference['boundaries'] or not reference.get('snapshot') or
            reference['decoderImageSha256'] != sha(n.image)):
        raise ValueError('A complete matching original character reference graph is required')
    for path,digest in reference['inputs'].items():
        if sha(fixture.raw(Path(path))) != digest:
            raise ValueError('Character graph input changed: '+path)
    for path,digest in reference['sources'].items():
        if sha(fixture.raw(fixture.root/'tools'/path)) != digest:
            raise ValueError('Character graph producer changed: '+path)
    for block in reference['originalBlocks']:
        if sha(n.image[block['rva']:block['rva']+block['size']]) != block['sha256']:
            raise ValueError('Original character graph instructions changed')
    restore(fixture,reference['snapshot'])
    texture_manager = n.initialize_texture_manager_prefix()
    resource_groups = n.initialize_resource_groups()
    fixed = reference['fixups']
    if (n.q(fixed['contextAddress']) != fixed['libraryAddress'] or
            n.q(fixed['libraryAddress']+0x10) != fixed['tableAddress'] or
            n.u32(fixed['libraryAddress']+0x18) != reference['counts']['loadedRoots']):
        raise ValueError('Restored character library differs from original fixup observation')
    cells = {descriptor:n.allocate(8) for descriptor in [LIBRARY_TLS,ENTRY_TLS]}
    for descriptor,cell in cells.items():
        n.slots[n.base+descriptor] = cell
        n.put(n.base+descriptor,'Q',ADDRESSES['tls'])
    all_roots = {case['identity']:case for case in reference['cases']}
    roots = {identity:case for identity,case in all_roots.items()
             if not args.selected_types or case['typeHash'] in args.selected_types}
    if not roots:
        raise ValueError('No original roots match the explicitly selected types')
    postload_table = n.allocate(len(roots)*24)
    for index,(identity,case) in enumerate(sorted(roots.items())):
        n.put(postload_table+index*24,'QQII',case['loaded']['object'],n.types[case['typeHash']],identity,0)
    entered,completed = [],[]
    def root_identity():
        entry = n.q(cells[ENTRY_TLS])
        if not (postload_table <= entry < postload_table+len(roots)*24 and
                (entry-postload_table) % 24 == 0):
            raise ValueError('Original post-load selected an unowned table entry')
        identity = n.u32(entry+0x10)
        if identity not in roots or n.q(entry) != roots[identity]['loaded']['object']:
            raise ValueError('Original post-load root differs from its fixed graph')
        return identity
    def observe_enter(engine,address,size,user):
        entered.append(root_identity())
    def observe_complete(engine,address,size,user):
        completed.append(root_identity())
        if len(completed) % 50 == 0:
            print(json.dumps({'actor':args.actor,'postloadedRoots':len(completed),'visits':len(n.visits)}),flush=True)
    for address,callback in [(0x14bb5cc,observe_enter),(0x14bb5d8,observe_complete)]:
        n.u.hook_add(unicorn.UC_HOOK_CODE,callback,begin=n.base+address,end=n.base+address)
    n.u.ctl_remove_cache(n.base+START,n.base+END)
    frame = ADDRESSES['stack']-8
    n.u.mem_write(frame-0x300,bytes(0x300))
    n.put(frame-0x178,'Q',fixed['contextAddress'])
    n.put(frame-0x160,'Q',len(roots))
    n.u.context_restore(n.initial)
    for register,value in {r.UC_X86_REG_RBP:frame,r.UC_X86_REG_RSP:frame-0x1e0,
                           r.UC_X86_REG_R15:postload_table}.items():
        n.u.reg_write(register,value)
    n.visits,n.math_calls = [],[]
    n.postloading = n.loading = True
    start,slices,boundary = n.base+START,[],None
    try:
        for index in range(64):
            before = len(n.visits)
            n.u.emu_start(start,n.base+END,count=5000000)
            start = n.u.reg_read(r.UC_X86_REG_RIP)
            slices.append({'index':index,'newVisits':len(n.visits)-before,'completedRoots':len(completed)})
            if start == n.base+END:
                break
            if len(n.visits) <= before:
                raise ValueError('Original library post-load exhausted a slice without object-visit progress')
        else:
            raise ValueError('Original library post-load exceeded sixty-four bounded instruction slices')
    except Exception as exception:
        registers = {name:n.u.reg_read(getattr(r,'UC_X86_REG_'+name.upper()))
                     for name in ['rax','rbx','rcx','rdx','rdi','rsi','r8','r9','r13','r14','r15','rbp','rsp']}
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'rootIdentity':entered[-1] if len(entered) > len(completed) else None,
                    'lastVisit':n.visits[-1] if n.visits else None,'registers':registers,
                    'registerMemoryHex':{name:bytes(n.u.mem_read(value,64)).hex() for name,value in registers.items()
                                         if n.library_pointer(value,64)},
                    'stackHex':bytes(n.u.mem_read(registers['rsp'],256)).hex()}
    finally:
        n.postloading = n.loading = False
    complete = boundary is None
    if complete and (entered != sorted(roots) or completed != entered or any(n.q(cell) for cell in cells.values())):
        raise ValueError('Original post-load stage did not visit all supplied roots and restore TLS')
    suffix = '-types-'+'-'.join(format(identity,'08x') for identity in sorted(set(args.selected_types))) if args.selected_types else ''
    final_snapshot = capture(n,cache/'research'/('character-asset-postload-'+args.actor.replace('/','-')+suffix+'-heap.bin')) if complete else None
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(__file__).with_name('character_graph_snapshot.py'),
             *[Path(inspect.getfile(c)) for c in NativeCharacterPostload.__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-character-library-postload-observations','actorKey':args.actor,
              'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
              'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'originalStage':{'start':START,'end':END},
              'callerSuppliedRootOrder':sorted(roots),'selectedTypes':args.selected_types,
              'postloadTable':postload_table,'enteredRoots':entered,'completedRoots':completed,
              'tls':{'cells':cells,'valuesAfter':{descriptor:n.q(cell) for descriptor,cell in cells.items()}},
              'visits':n.visits,'instructionSlices':slices,'mathCalls':n.math_calls,
              'formatCalls':n.character_format_calls,'textureManager':texture_manager,
              'resourceGroups':resource_groups,'boundary':boundary,'resourceBoundary':n.character_resource_boundary,
              'counts':{'graphRoots':len(all_roots),'suppliedRoots':len(roots),'enteredRoots':len(entered),'completedRoots':len(completed),
                        'objectVisits':len(n.visits),'uniqueObjectsVisited':len({v['object'] for v in n.visits}),
                        'boundaries':int(boundary is not None)},'snapshot':final_snapshot,
              'scope':{'originalLibraryPostloadStageExecuted':True,'completeSuppliedStage':complete,
                       'allGraphRootsPostloaded':complete and len(roots) == len(all_roots),
                       'originalRootOrderRecovered':False,'callerSuppliedRootOrder':True,
                       'globalAssetRegistryInstalled':False,'assetReadinessVerified':False,
                       'unitCallbacksExecuted':False,'mainViewerExpanded':False}}
    output = cache/'research'/('character-asset-postload-'+args.actor.replace('/','-')+suffix+'-native.json')
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts'],'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()
