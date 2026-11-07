"""Execute original subchunk-table loading with an explicit installed Game root."""
from pathlib import Path
import struct
from unicorn import x86_const as r
from xxhash import xxh64_intdigest
import zstandard
from vfx_spawn_native import sha, ADDRESSES


def load_installed_subchunks(fixture, installation, path, archive, encoded):
    n = fixture.native
    root = (Path(installation).resolve() / 'Game').resolve()
    path = Path(path).resolve()
    if not path.is_relative_to(root) or n.q(archive['object'] + 0x60):
        raise ValueError('Uninitialized explicitly installed archive required')
    count = struct.unpack_from('<I', encoded, 268)[0]
    rows = {struct.unpack_from('<Q', encoded, 272 + i * 32)[0]: 272 + i * 32 for i in range(count)}
    chunked = any(encoded[at + 20] & 15 == 4 for at in rows.values())
    name = path.relative_to(root).as_posix().removesuffix('.client') + '.subchunktoc'
    at = rows.get(xxh64_intdigest(name.lower()))
    if at is None:
        if chunked:
            raise ValueError('Installed chunked archive lacks its required subchunk table')
        return {'required': False, 'loaded': False, 'path': name}
    offset, compressed, size = struct.unpack_from('<III', encoded, at + 8)
    kind = encoded[at + 20] & 15
    if kind not in [0, 3] or offset + compressed > len(encoded) or not 0 < size <= 0x800000 or size % 16:
        raise ValueError('Installed subchunk table exceeds its byte/format bounds')
    payload = encoded[offset:offset + compressed]
    expected = payload if kind == 0 else zstandard.ZstdDecompressor().decompress(payload, max_output_size=size)
    if len(expected) != size:
        raise ValueError('Independent subchunk table decoded size differs')
    mutex = n.base + 0x256c2e0
    if mutex not in n.mutexes:
        n.call(0x14736c2, {}, 0x14736d3)
    if mutex not in n.mutexes or n.mutexes[mutex]:
        raise ValueError('Original archive decompression mutex must be initialized and unlocked')
    prefix = n.allocate(16)
    n.call(0x14c2d60, {r.UC_X86_REG_RDI: prefix,
                      r.UC_X86_REG_RSI: n.allocate_text(root.as_posix())})
    # The complete loader derives the hash from the archive's actual name,
    # strips its supplied root, finds the original index row and decodes it.
    # Larger valid tables exceed the small component call's instruction slice.
    # Resume one original call, retaining its stack and all native state.
    n.u.context_restore(n.initial)
    n.put(ADDRESSES['stack'], 'Q', ADDRESSES['stop'])
    n.u.reg_write(r.UC_X86_REG_RSP, ADDRESSES['stack'])
    n.u.reg_write(r.UC_X86_REG_RDI, archive['object'])
    n.u.reg_write(r.UC_X86_REG_RSI, prefix)
    start = n.base + 0x147a970
    slices = []
    for index in range(64):
        n.u.emu_start(start, ADDRESSES['stop'], count=5000000)
        start = n.u.reg_read(r.UC_X86_REG_RIP)
        slices.append({'slice': index + 1, 'instructionBound': 5000000, 'stop': start})
        if start == ADDRESSES['stop']:
            break
    else:
        raise ValueError('Original subchunk table loader exceeded 64 bounded instruction slices')
    pointer, entries = n.q(archive['object'] + 0x60), n.u32(archive['object'] + 0x68)
    if entries * 16 != size or not n.library_pointer(pointer, size):
        raise ValueError('Original subchunk table did not retain owned decoded bytes')
    actual = bytes(n.u.mem_read(pointer, size))
    if actual != expected:
        raise ValueError('Original subchunk table differs from independent installed bytes')
    n.call(0x14c2e80, {r.UC_X86_REG_RDI: prefix})
    return {'required': chunked, 'loaded': True, 'path': name,
            'pointer': pointer, 'entries': entries, 'sha256': sha(actual),
            'originalLoaderRva': 0x147a970, 'suppliedGameRoot': root.as_posix(),
            'decompressionMutexOriginalPrefixRva': 0x14736c2,
            'executionSlices': slices,
            'originalDecompressionExecuted': kind == 3, 'independentBytesCompared': True}
