"""Minimal read-only Mach-O metadata for static x86-64 decoder preparation."""
import struct


class MachImage:
    def __init__(self, binary):
        if binary[:4] != bytes.fromhex("cafebabe"):
            raise ValueError("Expected a universal Mach-O binary")
        candidates = []
        count = struct.unpack_from(">I", binary, 4)[0]
        for index in range(count):
            cpu, _, offset, size, _ = struct.unpack_from(">IIIII", binary, 8 + index * 20)
            if offset + size > len(binary):
                raise ValueError("Mach-O slice exceeds binary")
            if cpu == 0x1000007:
                candidates.append(binary[offset:offset + size])
        if len(candidates) != 1:
            raise ValueError("Expected one x86-64 Mach-O slice")
        self.binary = data = candidates[0]
        if data[:4] != bytes.fromhex("cffaedfe"):
            raise ValueError("Expected little-endian Mach-O64")
        self.segments = []
        self.sections = []
        symtab = indirect = None
        cursor = 32
        commands, commands_size = struct.unpack_from("<II", data, 16)
        commands_end = cursor + commands_size
        if commands_end > len(data):
            raise ValueError("Truncated load commands")
        for _ in range(commands):
            command, size = struct.unpack_from("<II", data, cursor)
            if size < 8 or cursor + size > commands_end:
                raise ValueError("Invalid load command bounds")
            if command == 0x19:
                name = data[cursor + 8:cursor + 24].rstrip(b"\0").decode("ascii")
                address, virtual_size, offset, file_size = struct.unpack_from("<QQQQ", data, cursor + 24)
                if offset + file_size > len(data) or file_size > virtual_size:
                    raise ValueError("Invalid segment bounds")
                if name != "__PAGEZERO":
                    self.segments.append((name, address, virtual_size, offset, file_size))
                section_count = struct.unpack_from("<I", data, cursor + 64)[0]
                if 72 + section_count * 80 > size:
                    raise ValueError("Invalid section table")
                for index in range(section_count):
                    at = cursor + 72 + index * 80
                    section_name = data[at:at + 16].rstrip(b"\0").decode("ascii")
                    section_address, section_size, section_offset = struct.unpack_from("<QQI", data, at + 32)
                    reserved1, reserved2 = struct.unpack_from("<II", data, at + 68)
                    self.sections.append((section_name, section_address, section_size, section_offset, reserved1, reserved2))
            elif command == 2:
                symtab = struct.unpack_from("<IIII", data, cursor + 8)
            elif command == 0xb:
                indirect = struct.unpack_from("<II", data, cursor + 56)
            cursor += size
        if cursor != commands_end or not self.segments:
            raise ValueError("Invalid Mach-O command/segment layout")
        self.base = min(segment[1] for segment in self.segments)
        image_size = max(address + size for _, address, size, _, _ in self.segments) - self.base
        if image_size > 128 * 1024 * 1024:
            raise ValueError("Mach-O image exceeds preparation limit")
        self.image = bytearray((image_size + 4095) & ~4095)
        for _, address, _, offset, size in self.segments:
            self.image[address - self.base:address - self.base + size] = data[offset:offset + size]
        self.imports = {}
        self.data_imports = {}
        if symtab is None or indirect is None:
            raise ValueError("Missing import metadata")
        symbol_offset, symbol_count, string_offset, string_size = symtab
        indirect_offset, indirect_count = indirect
        if symbol_offset + symbol_count * 16 > len(data) or string_offset + string_size > len(data) or indirect_offset + indirect_count * 4 > len(data):
            raise ValueError("Import tables exceed binary")
        names = []
        for index in range(symbol_count):
            at = string_offset + struct.unpack_from("<I", data, symbol_offset + index * 16)[0]
            if not string_offset <= at < string_offset + string_size:
                raise ValueError("Invalid import name offset")
            end = data.index(b"\0", at, string_offset + string_size)
            names.append(data[at:end].decode("utf-8"))
        for name, address, size, _, first, stride in self.sections:
            if name in ["__got", "__la_symbol_ptr"]:
                stride = 8
                output = self.data_imports
            elif name == "__stubs":
                output = self.imports
            else:
                continue
            if stride == 0 or size % stride or first + size // stride > indirect_count:
                raise ValueError("Invalid import stub table")
            for index in range(size // stride):
                symbol = struct.unpack_from("<I", data, indirect_offset + (first + index) * 4)[0]
                if symbol < len(names):
                    output[address - self.base + index * stride] = names[symbol]
