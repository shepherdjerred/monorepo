"""Compare original WAD Zstandard payload decoding against independent bytes."""
import argparse
import inspect
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
import zstandard
from xxhash import xxh64_intdigest
from character_script_native import NativeCharacterScripts
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('installation',type=Path)
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeCharacterScripts)
    n = fixture.native
    encoded = fixture.raw(args.installation/'Game/DATA/FINAL/Scripts.wad.client')
    fixture.raw(fixture.cache/'research/darwin-errlst.c')
    proof = fixture.read(fixture.cache/'research/native-wad-files.json')
    archive_path = str((args.installation/'Game/DATA/FINAL/Scripts.wad.client').resolve())
    if (proof['boundary'] or not proof['scope']['archiveLoaded'] or
            proof['inputs'][archive_path] != sha(encoded) or proof['decoderImageSha256'] != sha(n.image)):
        raise ValueError('Matching original archive validation required')
    for source,digest in proof['sources'].items():
        if sha(fixture.raw(fixture.root/'tools'/source)) != digest:
            raise ValueError('Archive validation producer changed: '+source)
    for source,digest in proof['inputs'].items():
        if sha(fixture.raw(Path(source))) != digest:
            raise ValueError('Archive validation input changed: '+source)
    if sha(fixture.raw(args.installation/'Game/League of Legends.exe')) != n.profile['windowsClientSha256']:
        raise ValueError('Matching installed executable required for payload comparison')
    count = struct.unpack_from('<I',encoded,268)[0]
    rows = {struct.unpack_from('<Q',encoded,272+i*32)[0]:272+i*32 for i in range(count)}
    vm = n.initialize_character_script_vm()
    results,boundary = [],None
    try:
        for character in ['viego','karthus','gangplank']:
            for extension in ['luabin64','preload']:
                path = 'data/characters/'+character+'/charscript'+character+'.'+extension
                at = rows[xxh64_intdigest(path)]
                offset,compressed,length = struct.unpack_from('<III',encoded,at+8)
                kind = encoded[at+20]&15
                if length > 65536 or compressed > 65536 or offset+compressed > len(encoded):
                    raise ValueError('Scoped character payload exceeds archive bounds')
                payload = encoded[offset:offset+compressed]
                expected = zstandard.ZstdDecompressor().decompress(payload) if kind == 3 else payload if kind == 0 else None
                if expected is None or len(expected) != length:
                    raise ValueError('Unsupported or invalid scoped character payload')
                if kind == 3:
                    n.call(0x142ad10,{})
                    context = n.u.reg_read(r.UC_X86_REG_RAX)
                    source,target = n.allocate(compressed),n.allocate(length)
                    n.u.mem_write(source,payload)
                    n.call(0x142acf0,{r.UC_X86_REG_RDI:context,r.UC_X86_REG_RSI:target,
                                     r.UC_X86_REG_RDX:length,r.UC_X86_REG_RCX:source,r.UC_X86_REG_R8:compressed})
                    actual_length = n.u.reg_read(r.UC_X86_REG_RAX)
                    actual = bytes(n.u.mem_read(target,length))
                    n.call(0x142abe0,{r.UC_X86_REG_RDI:context})
                    if n.u.reg_read(r.UC_X86_REG_RAX)&255 or actual_length != length or actual != expected:
                        raise ValueError('Original Zstandard payload differs from independent decoding')
                    n.call(0x142add0,{r.UC_X86_REG_RDI:context})
                    results.append({'path':path,'compression':kind,'compressedBytes':compressed,
                                    'decodedBytes':length,'sha256':sha(actual),'originalDecompressionExecuted':True})
                else:
                    results.append({'path':path,'compression':kind,'decodedBytes':length,'sha256':sha(expected),
                                    'originalDecompressionExecuted':False})
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper()))
                                 for key in ['rax','rbx','rcx','rdx','rdi','rsi','rbp','rsp']}}
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-wad-payload-comparison','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
              'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'vm':vm,'cases':results,'boundary':boundary,
              'scope':{'nativeDecompressionCompared':boundary is None and len(results) == 6,
                       'characterScriptsExecuted':False,'mainViewerExpanded':False}}
    output = fixture.cache/'research/native-wad-payloads.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':results,'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()
