"""Bounded regular Mach-O pointer-bind inventory; no dynamic loader is modeled.

Opcode authority: Apple's mach-o/loader.h (BIND_OPCODE_* declarations).
https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h
"""
import struct


def pointer_bindings(binary):
    if binary[:4] != bytes.fromhex('cffaedfe') or len(binary) < 32:
        raise ValueError('Original thin little-endian Mach-O64 required')
    count, size = struct.unpack_from('<II', binary, 16)
    if count > 4096 or 32+size > len(binary):
        raise ValueError('Mach-O command bounds differ')
    cursor, segments, streams = 32, [], []
    for _ in range(count):
        if cursor+8 > 32+size:
            raise ValueError('Truncated Mach-O command')
        command, length = struct.unpack_from('<II', binary, cursor)
        if length < 8 or cursor+length > 32+size:
            raise ValueError('Invalid Mach-O command length')
        if command == 0x19:
            if length < 72:
                raise ValueError('Truncated Mach-O segment')
            segments.append(struct.unpack_from('<QQ', binary, cursor+24))
        if command in [0x22, 0x80000022]:
            if length != 48:
                raise ValueError('Invalid dyld-info command')
            streams.append(struct.unpack_from('<II', binary, cursor+16))
        cursor += length
    if cursor != 32+size or len(streams) != 1:
        raise ValueError('Exactly one bounded regular bind stream required')
    offset, length = streams[0]
    if not 0 < length <= 4*1024*1024 or offset+length > len(binary):
        raise ValueError('Regular bind stream exceeds source')
    data, at, segment, displacement, symbol, kind, addend, rows = binary[offset:offset+length], 0, None, 0, None, 0, 0, {}
    def leb(signed=False):
        nonlocal at
        value = 0
        for index in range(10):
            if at >= len(data):
                raise ValueError('Truncated dyld LEB')
            byte = data[at]
            at += 1
            value |= (byte & 0x7f) << (7*index)
            if not byte & 0x80:
                if signed and byte & 0x40:
                    value -= 1 << (7*(index+1))
                if not -(1 << 63) <= value < 1 << 64:
                    raise ValueError('Dyld LEB width exceeds64bits')
                return value
        raise ValueError('Dyld LEB width exceeds64bits')
    def bind():
        if segment is None or segment >= len(segments) or kind != 1 or not symbol:
            raise ValueError('Unsupported/unbound original pointer binding')
        address, extent = segments[segment]
        if not 0 <= displacement <= extent-8 or len(rows) >= 65536:
            raise ValueError(f'Original pointer binding escapes segment/quota: segment={segment} offset={displacement} extent={extent} rows={len(rows)} symbol={symbol}')
        target = address+displacement
        if target in rows:
            raise ValueError('Duplicate original pointer-binding address')
        rows[target] = {'symbol': symbol, 'addend': addend}
    while at < len(data):
        byte = data[at]
        at += 1
        opcode, immediate = byte & 0xf0, byte & 15
        if opcode == 0:
            if any(data[at:]):
                raise ValueError('Unexpected records after regular bind terminator')
            return rows
        if opcode in [0x10, 0x30]:
            continue
        if opcode == 0x20:
            leb()
        elif opcode == 0x40:
            end = data.find(b'\0', at)
            if not at < end <= at+4096:
                raise ValueError('Unterminated/bounded original bind symbol required')
            symbol, at = data[at:end].decode('ascii'), end+1
        elif opcode == 0x50:
            kind = immediate
        elif opcode == 0x60:
            addend = leb(True)
        elif opcode == 0x70:
            segment, displacement = immediate, leb()
        elif opcode == 0x80:
            displacement = (displacement+leb()) & 0xffffffffffffffff
        elif opcode in [0x90, 0xa0, 0xb0]:
            bind()
            displacement = (displacement+8+(leb() if opcode == 0xa0 else immediate*8 if opcode == 0xb0 else 0)) & 0xffffffffffffffff
        elif opcode == 0xc0:
            repeats, skip = leb(), leb()
            if not 0 < repeats <= 65536:
                raise ValueError('Original bind repetition quota exceeded')
            for _ in range(repeats):
                bind()
                displacement = (displacement+8+skip) & 0xffffffffffffffff
        else:
            raise ValueError('Unsupported original dyld binding opcode')
    raise ValueError('Missing regular bind-stream terminator')
