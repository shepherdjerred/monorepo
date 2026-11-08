"""Register the exact installed Scripts archive using original validation."""
from pathlib import Path
import struct
from vfx_spawn_native import sha


def prepare_scripts(fixture,installation):
    n = fixture.native
    installation = Path(installation).resolve()
    executable = fixture.raw(installation/'Game/League of Legends.exe')
    if sha(executable) != n.profile['windowsClientSha256']:
        raise ValueError('Exact matching installed Windows asset build required')
    path = installation/'Game/DATA/FINAL/Scripts.wad.client'
    encoded = fixture.raw(path)
    fixture.raw(fixture.cache/'research/darwin-errlst.c')
    if encoded[:4] != b'RW\x03\x04':
        raise ValueError('Matching installed WAD 3.4 archive required')
    count = struct.unpack_from('<I',encoded,268)[0]
    if not 0 < count <= 262144:
        raise ValueError('Installed WAD entry count exceeds bounds')
    index = encoded[272:272+count*32]
    if len(index) != count*32:
        raise ValueError('Installed WAD index is truncated')
    n.allow_file(path)
    manager = n.file_manager()
    archive = n.register_archive(manager,path)
    if (archive['entries'] != count or bytes(n.u.mem_read(archive['table'],len(index))) != index or
            n.archive_digests != [sha(index)]):
        raise ValueError('Original WAD index/digest differs from independent installed bytes')
    return {'manager':manager,'archive':archive,'path':str(path),'fileSha256':sha(encoded),
            'headerSha256':sha(encoded[:272]),'indexSha256':sha(index),
            'originalSignatureValidationCompleted':True,'payloadDecoded':False}
