"""Load the real script manifest with original code and compare every field."""
import argparse
import inspect
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from spell_preload_native import NativeSpellPreload
from script_manifest_native import load_manifest
from installed_scripts_native import prepare_scripts
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha
from xxhash import xxh64_intdigest


def compare_shared_paths(fixture,scripts,manifest,all_names):
    n = fixture.native
    encoded = fixture.raw(Path(scripts['path']))
    count = struct.unpack_from('<I',encoded,268)[0]
    file_hashes = {struct.unpack_from('<Q',encoded,272+i*32)[0] for i in range(count)}
    owner = manifest['object']
    at,count = n.q(owner+0x10),n.u32(owner+0x18)
    names = [bytes(n.u.mem_read(n.q(at+i*16),n.u32(at+i*16+8))).decode('utf-8') for i in range(count)]
    if not all_names:names = [names[i] for i in range(0,len(names),max(1,len(names)//64))]
    names = list(dict.fromkeys(['_globalchampionbuff',*names,'__scout_missing_build16_21_script__']))
    extension = n.allocate_text('luabin64')
    probes = []
    for name in names:
        source,target = n.allocate(16),n.allocate(16)
        n.call(0x14c2d60,{r.UC_X86_REG_RDI:source,r.UC_X86_REG_RSI:n.allocate_text(name)})
        n.call(0x14c2d60,{r.UC_X86_REG_RDI:target,r.UC_X86_REG_RSI:n.allocate_text('')})
        n.call(0x85d790,{r.UC_X86_REG_RDI:source,r.UC_X86_REG_RSI:0,
                         r.UC_X86_REG_RDX:extension,r.UC_X86_REG_RCX:target})
        result = n.u.reg_read(r.UC_X86_REG_RAX)&255
        if result not in [0,1]:raise ValueError('Original shared script resolver returned a non-boolean')
        length,pointer = n.u32(target+8),n.q(target)
        if length > 4096 or not n.library_pointer(pointer,length):
            raise ValueError('Original shared script output escaped owned string bounds')
        path = bytes(n.u.mem_read(pointer,length)).decode('utf-8')
        exists = bool(path) and xxh64_intdigest(path.replace('\\','/').lower()) in file_hashes
        if bool(result) != exists:
            raise ValueError('Original shared script result disagrees with archive path membership')
        if name == '_globalchampionbuff' and path.lower() != 'data/shared/spells/_globalchampionbuff.luabin64':
            raise ValueError('The actual shared champion spell was not resolved through its manifest')
        if name == '__scout_missing_build16_21_script__' and result:
            raise ValueError('Original shared script resolver accepted the missing-name control')
        probes.append({'name':name,'path':path,'found':bool(result),'archiveMembership':exists})
        for value in [source,target]:n.call(0x14c2e80,{r.UC_X86_REG_RDI:value})
    return probes


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','installation']:p.add_argument(name,type=Path)
    p.add_argument('--paths',action='store_true',help='Compare sampled original shared-script paths with archive membership')
    p.add_argument('--all-shared',action='store_true',help='Compare the complete shared-name vector')
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeSpellPreload)
    n = fixture.native
    scripts,vm,manifest,boundary = None,None,None,None
    probes = []
    tail = []
    def remember(uc,address,size,user):
        tail.append({'rva':address-n.base,'size':size})
        if len(tail)>48:del tail[0]
    n.u.hook_add(unicorn.UC_HOOK_BLOCK,remember,begin=n.base,end=n.base+len(n.image)-1)
    try:
        scripts = prepare_scripts(fixture,args.installation)
        vm = n.initialize_character_script_vm()
        manifest = load_manifest(fixture,scripts)
        if args.paths or args.all_shared:probes = compare_shared_paths(fixture,scripts,manifest,args.all_shared)
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper()))
                                 for key in ['rax','rbx','rcx','rdx','rdi','rsi','r12','r13','r14','r15','rbp','rsp']},
                    'lastBlocks':list(tail)}
    finally:
        n.close_files()
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(load_manifest)),Path(inspect.getfile(prepare_scripts)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-script-manifest-comparison','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
              'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'scripts':scripts,'vm':vm,'manifest':manifest,'boundary':boundary,
              'fileCalls':n.file_calls,
              'sharedPathProbes':probes,'allSharedNamesRequested':args.all_shared,
              'scope':{'allManifestFieldsCompared':manifest is not None,'gameBindingsRegistered':False,
                       'liveWorldRoutingVerified':False,'mainViewerExpanded':False}}
    output = fixture.cache/'research'/('script-manifest'+('-all-shared-paths' if args.all_shared else '-paths' if args.paths else '')+'-native.json')
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'manifest':manifest,'pathProbes':len(probes),
                      'pathsFound':sum(row['found'] for row in probes),'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()
