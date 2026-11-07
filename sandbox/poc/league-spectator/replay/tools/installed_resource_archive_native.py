"""Register an explicitly selected installed resource archive with native validation."""
from pathlib import Path
import struct
from vfx_spawn_native import sha


def register_resource_archive(fixture,installation,relative_path):
    n = fixture.native
    installation = Path(installation).resolve()
    if sha(fixture.raw(installation/'Game/League of Legends.exe')) != n.profile['windowsClientSha256']:
        raise ValueError('Exact matching installed resource build required')
    directory = (installation/'Game/DATA/FINAL').resolve()
    path = (directory/relative_path).resolve()
    if not path.is_relative_to(directory) or path.suffix != '.client':
        raise ValueError('Explicit installed DATA/FINAL archive required')
    encoded = fixture.raw(path)
    fixture.raw(fixture.cache/'research/darwin-errlst.c')
    if encoded[:4] != b'RW\x03\x04' or len(encoded) < 272:
        raise ValueError('Matching installed WAD 3.4 archive required')
    count = struct.unpack_from('<I',encoded,268)[0]
    if not 0 < count <= 262144:
        raise ValueError('Installed resource index exceeds bounds')
    index = encoded[272:272+count*32]
    if len(index) != count*32:
        raise ValueError('Installed resource index is truncated')
    n.allow_file(path)
    manager = n.q(n.base+0x246d7b0)
    if manager:
        if n.allocations.get(manager) != 0x70:
            raise ValueError('Existing native resource archive manager is unowned')
    else:
        manager = n.file_manager()
    before = len(n.archive_digests)
    archive = n.register_archive(manager,path)
    if (archive['entries'] != count or bytes(n.u.mem_read(archive['table'],len(index))) != index or
            n.archive_digests[before:] != [sha(index)]):
        raise ValueError('Original resource archive index/digest differs from installed bytes')
    return {'manager':manager,'archive':archive,'path':str(path),'fileSha256':sha(encoded),
            'headerSha256':sha(encoded[:272]),'indexSha256':sha(index),
            'originalSignatureValidationCompleted':True,'payloadDecoded':False}
