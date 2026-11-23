"""Read exact Mach-O LC_FUNCTION_STARTS RVAs without guessed prologue bounds."""
import struct


def native_function_starts(data):
    cursor, table = 32, None
    for _ in range(struct.unpack_from("<I", data, 16)[0]):
        if cursor > len(data) - 8:
            raise ValueError("Truncated original Mach-O load command")
        command, size = struct.unpack_from("<II", data, cursor)
        if size < 8 or cursor + size > len(data):
            raise ValueError("Invalid original Mach-O load command")
        if command == 0x26:
            if table is not None or size < 16:
                raise ValueError("Unique original function-start metadata required")
            table = struct.unpack_from("<II", data, cursor + 8)
        cursor += size
    if table is None:
        raise ValueError("Original LC_FUNCTION_STARTS required")
    offset, size = table
    if offset > len(data) - size:
        raise ValueError("Original function-start data exceeds binary")
    end, address, starts = offset + size, 0, []
    while offset < end:
        delta = shift = 0
        while True:
            if offset >= end or shift > 63:
                raise ValueError("Invalid original function-start delta")
            byte = data[offset]
            offset += 1
            delta |= (byte & 127) << shift
            shift += 7
            if byte < 128:
                break
        if not delta:
            if not starts:
                raise ValueError("Original function-start table is empty")
            return starts
        address += delta
        starts.append(address)
    raise ValueError("Original function-start terminator missing")
