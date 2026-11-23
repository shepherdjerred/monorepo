"""Execute original334 aggregate identity and buff-scalar argument prefixes.

Lookup, native entity acceptance and buff membership/lifetime remain separate.
Unimplemented aggregate row kinds retain their original bytes and route IDs.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha

ARENA, FRAME = 0x10200000, 0x100f5000


def prefix(n, start, end, registers):
    hook = n.u.hook_add(unicorn.UC_HOOK_CODE,
                        lambda engine, address, size, user: engine.emu_stop(),
                        begin=n.base+end, end=n.base+end)
    try:
        n.call(start, registers, end)
    finally:
        n.u.hook_del(hook)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'capture', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    encoded = args.capture.read_bytes()
    capture = json.loads(encoded)
    n = NativeSpawn(args.cache/'public/decoder-16.21-macos', args.client)
    paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    if (capture['kind'] != 'original-packet-window-capture' or capture['opcodes'] != [334] or
            capture['build'] != '16.21.829.8620' or capture['protocol'] != '20e09df23c66b85e' or
            capture['decoderImageSha256'] != sha(n.image) or not 0 < len(capture['records']) <= 10000):
        raise ValueError('Bounded exact original334 window capture required')
    for file, expected in capture['inputs'].items():
        if sha(Path(file).read_bytes()) != expected:
            raise ValueError('Original aggregate capture source changed: '+file)
    table = 0x6e70dc
    case = table+struct.unpack_from('<i',n.image,table+(334-7)*4)[0]
    if case != 0x6d6d01 or n.image[0x6d705a] != 0xe8 or 0x6d705f+struct.unpack_from('<i',n.image,0x6d705b)[0] != 0x8446c0:
        raise ValueError('Original334 dispatch/buff-scalar call differs')
    nested = 0x6e8488
    branches = [nested+struct.unpack_from('<i',n.image,nested+index*4)[0] for index in range(5)]
    if branches != [0x6d6e8b,0x6d7075,0x6d72ab,0x6d6d29,0x6d72c2]:
        raise ValueError('Original334 aggregate route table differs')
    records, histogram, boundary, active = [], {}, None, None
    try:
        for item in capture['records']:
            active = {'time':item['time'],'transportSequence':item['transportSequence']}
            obj, heap = bytes.fromhex(item['objectHex']), bytes.fromhex(item['heapHex'])
            if len(obj) != 32 or not heap.startswith(obj) or len(heap)>0x100000 or struct.unpack_from('<II',obj,8) != (334,item['param']):
                raise ValueError('Exact bounded original334 object/arena required')
            rows, count = struct.unpack_from('<QI',obj,0x10)
            offset = rows-ARENA
            if count>4096 or count and not 0<=offset<=len(heap)-count*48:
                raise ValueError('Original aggregate rows escaped captured arena')
            n.u.mem_write(ARENA,heap)
            n.u.mem_write(FRAME-0x400,bytes(0x800))
            for index in range(count):
                row_at, row_offset = rows+index*48, offset+index*48
                kind = struct.unpack_from('<I',heap,row_offset+8)[0]
                if not 1<=kind<=5:
                    raise ValueError('Unknown original aggregate route')
                histogram[kind]=histogram.get(kind,0)+1
                prefix(n,0x6d6d5e,0x6d6e16,{r.UC_X86_REG_RAX:rows,r.UC_X86_REG_R14:index*48,
                       r.UC_X86_REG_R13:n.base+0x20d6660,r.UC_X86_REG_RBP:FRAME})
                row = active | {key:item[key] for key in ['stream','chunkId','blockOffset']} | {
                    'recordIndex':index,'entityIdArgument':n.u.reg_read(r.UC_X86_REG_ESI),
                    'nativeRoute':kind,'originalRouteRva':branches[kind-1],
                    'sourceRowHex':heap[row_offset:row_offset+48].hex()}
                if kind == 1:
                    values, length = struct.unpack_from('<QI',heap,row_offset+0x18)
                    start=values-ARENA
                    if length>4096 or length and not 0<=start<=len(heap)-length*16:
                        raise ValueError('Original buff scalar rows escaped captured arena')
                    n.put(FRAME-0x370,'Q',row_at+0x10)
                    scalars=[]
                    for value_index in range(length):
                        prefix(n,0x6d6ed1,0x6d7057,{r.UC_X86_REG_RBX:values,r.UC_X86_REG_R14:value_index*16,
                               r.UC_X86_REG_R13:n.base+0x20d6660,r.UC_X86_REG_RBP:FRAME})
                        scalars.append({'index':value_index,'buffSlotArgument':n.u.reg_read(r.UC_X86_REG_ESI),
                                        'modifierIndexArgument':n.u.reg_read(r.UC_X86_REG_EDX),
                                        'valueBits':n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff})
                    row['buffScalarArguments']=scalars
                records.append(row)
    except Exception as error:
        boundary={'kind':type(error).__name__,'message':str(error),'active':active,
                  'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    ranges=[(0x6d6d01,0x6d6d29),(0x6d6d48,0x6d6e16),(0x6d6e59,0x6d6e8b),
            (0x6d6ed1,0x6d705f),(0x8446c0,0x844748)]
    for start,end in ranges:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original aggregate consumer bytes differ')
    if sources != {str(path.resolve()):sha(path.read_bytes()) for path in paths} or args.capture.read_bytes()!=encoded:
        raise ValueError('Original aggregate proof source changed')
    output={'schema':1,'kind':'original-unit-aggregate-prefix-observation','build':capture['build'],
            'protocol':capture['protocol'],'decoderImageSha256':sha(n.image),'captureSha256':sha(encoded),
            'replaySha256':capture['replaySha256'],'window':capture['window'],
            'records':records,'nativeRouteCounts':histogram,'boundary':boundary,'sources':sources,
            'sourceBlocks':[{'startRva':start,'endRva':end,'sha256':sha(n.image[start:end])} for start,end in ranges],
            'originalBlocks':list(n.blocks.values()),
            'scope':{'originalIdentityPrefixExecuted':boundary is None,
                     'originalBuffScalarArgumentPrefixExecuted':boundary is None and histogram.get(1,0)>0,
                     'otherAggregateKindsDecoded':False,'nativeWorldLookupExecuted':False,
                     'nativeBuffMembershipEstablished':False,'nativeHomeguardProviderEstablished':False,
                     'nativeGraphStateAdmitted':False}}
    args.output.write_text(json.dumps(output,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(args.output),'packets':len(capture['records']),'records':len(records),
                      'nativeRoutes':histogram,'boundary':boundary}))
    if boundary: raise SystemExit(1)


if __name__ == '__main__':
    main()
