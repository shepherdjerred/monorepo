"""Compare the original Lua manifest registry against independent binary fields."""
import struct
import zstandard
from xxhash import xxh64_intdigest
from pathlib import Path
from vfx_spawn_native import sha


def load_manifest(fixture,scripts):
    n = fixture.native
    encoded = fixture.raw(Path(scripts['path']))
    if sha(encoded) != scripts['fileSha256']:
        raise ValueError('Validated Scripts archive changed before manifest load')
    count = struct.unpack_from('<I',encoded,268)[0]
    key = xxh64_intdigest('data/all_lua_files.manifest')
    rows = [272+i*32 for i in range(count) if struct.unpack_from('<Q',encoded,272+i*32)[0] == key]
    if len(rows) != 1:raise ValueError('Exact script manifest archive entry required')
    at = rows[0]
    offset,compressed,length = struct.unpack_from('<III',encoded,at+8)
    if encoded[at+20]&15 != 3 or length > 0x400000 or offset+compressed > len(encoded):
        raise ValueError('Script manifest compression/size differs')
    raw = zstandard.ZstdDecompressor().decompress(encoded[offset:offset+compressed])
    if len(raw) != length:raise ValueError('Script manifest decoded size differs')
    cursor = 0
    def take(size):
        nonlocal cursor
        if size < 0 or cursor+size > len(raw):raise ValueError('Script manifest field exceeds input')
        result = raw[cursor:cursor+size]
        cursor += size
        return result
    def u32():return struct.unpack('<I',take(4))[0]
    def string():
        size = u32()
        if size > 4096:raise ValueError('Script manifest string exceeds count bound')
        return take(size).decode('utf-8')
    def strings():
        count = u32()
        if count > 131072:raise ValueError('Script manifest string vector exceeds count bound')
        return [string() for _ in range(count)]
    if u32() != 0x524c4d30:raise ValueError('Matching RLM0 script manifest required')
    groups_count = u32()
    if groups_count > 8192:raise ValueError('Script manifest namespace count exceeds bound')
    groups = [(string(),strings()) for _ in range(groups_count)]
    other_names = strings()
    hash_count = u32()
    if hash_count > 262144:raise ValueError('Script manifest lookup vector exceeds bound')
    hashes = take(hash_count*8)
    if cursor != len(raw):raise ValueError('Script manifest has unconsumed fields')
    registry = n.initialize_script_file_registry()
    owner = registry['object']
    def vector(at,stride,expected):
        pointer,count = n.q(at),n.u32(at+8)
        if count != expected or count and not n.library_pointer(pointer,count*stride):
            raise ValueError('Native manifest vector differs from independent bytes')
        return pointer
    def check_string(at,expected):
        encoded = expected.encode()
        pointer,count = n.q(at),n.u32(at+8)
        if count != len(encoded) or not n.library_pointer(pointer,count) or bytes(n.u.mem_read(pointer,count)) != encoded:
            raise ValueError('Native manifest string differs from independent bytes')
    pointer = vector(owner+0x20,32,len(groups))
    for index,(name,names) in enumerate(groups):
        row = pointer+index*32
        check_string(row,name)
        items = vector(row+16,16,len(names))
        for j,value in enumerate(names):check_string(items+j*16,value)
    pointer = vector(owner+0x10,16,len(other_names))
    for index,value in enumerate(other_names):check_string(pointer+index*16,value)
    pointer = vector(owner+0x30,8,hash_count)
    if bytes(n.u.mem_read(pointer,len(hashes))) != hashes:
        raise ValueError('Native manifest lookup hashes differ from independent bytes')
    registry.update(entriesCompared=True,manifestPath='data/all_lua_files.manifest',manifestSha256=sha(raw),
                    decodedBytes=len(raw),namespaceCount=len(groups),namespaceScripts=sum(len(names) for _,names in groups),
                    otherScriptNames=len(other_names),lookupEntries=hash_count,allSerializedFieldsCompared=True)
    return registry
