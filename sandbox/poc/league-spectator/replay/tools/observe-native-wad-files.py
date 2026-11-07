"""Probe original archive registration and file-existence lookup."""
import argparse
import inspect
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from wad_file_native import NativeWadFiles
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha
from xxhash import xxh64_intdigest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('installation',type=Path)
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeWadFiles)
    n,cache = fixture.native,fixture.cache
    executable = fixture.raw(args.installation/'Game/League of Legends.exe')
    if sha(executable) != n.profile['windowsClientSha256']:
        raise ValueError('Exact installed Windows asset build required')
    path = (args.installation/'Game/DATA/FINAL/Scripts.wad.client').resolve()
    source = fixture.raw(path)
    fixture.raw(cache/'research/darwin-errlst.c')
    if source[:4] != b'RW\x03\x04':
        raise ValueError('Matching installed WAD 3.4 archive required')
    count = struct.unpack_from('<I',source,268)[0]
    index = source[272:272+count*32]
    if len(index) != count*32 or not 0 < count <= 262144:
        raise ValueError('Installed WAD index bounds differ')
    hashes = {struct.unpack_from('<Q',index,i*32)[0] for i in range(count)}
    n.allow_file(path)
    tail = []
    def remember(engine,address,size,user):
        tail.append({'rva':address-n.base,'size':size})
        if len(tail)>48:del tail[0]
    n.u.hook_add(unicorn.UC_HOOK_BLOCK,remember,begin=n.base,end=n.base+len(n.image)-1)
    manager,archive,boundary = None,None,None
    probes = []
    try:
        manager = n.file_manager()
        archive = n.register_archive(manager,path)
        if (archive['entries'] != count or bytes(n.u.mem_read(archive['table'],len(index))) != index or
                n.archive_digests != [sha(index)]):
            raise ValueError('Original archive index/digest differs from independent installed bytes')
        for character in ['viego','karthus','gangplank']:
            for asset in ['data/characters/'+character+'/spells/charscript'+character+'.luabin64',
                          'data/characters/'+character+'/charscript'+character+'.luabin64',
                          'data/characters/'+character+'/charscript'+character+'.preload']:
                for requested in [asset,asset.upper().replace('/','\\')]:
                    key = xxh64_intdigest(asset)
                    expected = key in hashes
                    actual = n.file_exists(manager,requested)
                    if actual != expected:
                        raise ValueError('Original file lookup disagrees with independent WAD membership')
                    probes.append({'path':requested,'hash':format(key,'016x'),'expected':expected,'actual':actual})
    except Exception as exception:
        registers = {name:n.u.reg_read(getattr(r,'UC_X86_REG_'+name.upper()))
                     for name in ['rax','rbx','rcx','rdx','rdi','rsi','r8','r9','rbp','rsp']}
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionAddress':n.u.reg_read(r.UC_X86_REG_RIP),'registers':registers,
                    'lastBlocks':list(tail),'stackHex':bytes(n.u.mem_read(registers['rsp'],256)).hex()}
    finally:
        n.close_files()
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in NativeWadFiles.__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-wad-file-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
              'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'manager':manager,'archive':archive,'boundary':boundary,
              'fileCalls':n.file_calls,'scope':{'originalArchiveRegistrationExecuted':True,
                       'readOnlyAllowedInstalledFiles':True,'archiveLoaded':archive is not None,
                       'filePayloadDecoded':False,'mainViewerExpanded':False}}
    result.update(instructionSlices=n.archive_slices,indexDigests=n.archive_digests,
                  indexSha256=sha(index),fileExistenceProbes=probes,
                  platform={'emptyProcessEnvironment':True,'environmentQueries':n.file_environment_queries,
                            'onceInitializers':list(n.file_once.values()),'registeredExitCallbacks':n.file_exit_callbacks,
                            'readWriteLocks':n.file_rwlocks,'tlsKeys':n.file_keys})
    output = cache/'research/native-wad-files.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'archive':archive,'fileExistenceProbes':len(probes),
                      'indexDigests':n.archive_digests,'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()
