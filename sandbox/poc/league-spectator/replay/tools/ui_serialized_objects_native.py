"""Observe original BIN arena allocation and metadata-sized object placement.

Objects share one aligned allocation. An object pointer is not necessarily the
start of that allocation, and no separate object header is inferred here.
"""
import struct

import unicorn
from unicorn import x86_const as r


class UiSerializedObjects:
    def __init__(self, n):
        self.n = n
        self.arenas = {}
        self.objects = {}
        self.hooks = []
        gates = [
            (0x14BB1F7, "48894320", self.allocation),
            (0x14BBB0A, "807b2900", self.placement),
        ]
        for at, encoded, callback in gates:
            if n.image[at:at + len(bytes.fromhex(encoded))] != bytes.fromhex(encoded):
                raise ValueError("Original BIN allocation/placement instruction changed")
            self.hooks.append(n.u.hook_add(unicorn.UC_HOOK_CODE, callback,
                begin=n.base + at, end=n.base + at))
            n.u.ctl_remove_cache(n.base + at, n.base + at + 16)

    def allocation(self, engine, address, size, user):
        n = self.n
        owner = engine.reg_read(r.UC_X86_REG_RBX)
        pointer = engine.reg_read(r.UC_X86_REG_RAX)
        count = engine.reg_read(r.UC_X86_REG_R14)
        alignment = engine.reg_read(r.UC_X86_REG_R12)
        allocation = n.asset_aligned_allocations.get(pointer)
        if (not n.library_pointer(owner, 0x38) or allocation is None or
                allocation['retired'] or allocation['bytes'] != count or
                allocation['alignment'] != max(8, alignment) or
                allocation['returnRva'] != 0x14BB1F7):
            raise ValueError("Original BIN arena has no matching live aligned allocation")
        self.arenas[owner] = {"owner": owner, "pointer": pointer, "bytes": count,
            "alignment": alignment, "allocationBase": allocation['base'],
            "allocationCallRva": 0x14BB1F2}

    def placement(self, engine, address, size, user):
        n = self.n
        reader = engine.reg_read(r.UC_X86_REG_RBX)
        pointer = engine.reg_read(r.UC_X86_REG_R14)
        frame = engine.reg_read(r.UC_X86_REG_RBP)
        metadata = n.q(frame - 0x60)
        if not n.library_pointer(reader, 8):
            raise ValueError("Original BIN object reader is not owned")
        owner = n.q(reader)
        arena = self.arenas.get(owner)
        if arena is None or not n.library_pointer(metadata, 0x50):
            raise ValueError("Original BIN object has no observed arena/type metadata")
        count, alignment = n.q(metadata + 0x40), n.q(metadata + 0x48)
        class_hash = struct.unpack('<I', n.u.mem_read(metadata + 8, 4))[0]
        if (n.q(owner + 0x20) != arena['pointer'] or not count or not alignment or
                alignment & (alignment - 1) or pointer % alignment or
                not arena['pointer'] <= pointer <= arena['pointer'] + arena['bytes'] - count):
            raise ValueError("Original BIN typed object escaped its declared aligned arena")
        if len(self.objects) >= 8192 or pointer in self.objects:
            raise ValueError("Original BIN object observation duplicate/count boundary")
        self.objects[pointer] = {"pointer": pointer, "bytes": count,
            "alignment": alignment, "metadata": metadata, "classHash": class_hash,
            "reader": reader, "arena": arena['pointer'], "arenaBytes": arena['bytes'],
            "placementRva": 0x14BBB03}

    def require(self, pointer, size, vtable=None):
        n = self.n
        record = self.objects.get(pointer)
        if record is None or record['bytes'] != size:
            raise ValueError("Published UI object lacks an exact original typed placement")
        allocation = n.asset_aligned_allocations.get(record['arena'])
        if allocation is None or allocation['retired'] or allocation['bytes'] != record['arenaBytes']:
            raise ValueError("Published UI object has no live original BIN arena")
        if vtable is not None and n.q(pointer) != n.base + vtable:
            raise ValueError("Published UI object has a different original class vtable")
        return dict(record)

    def close(self):
        for hook in self.hooks:
            self.n.u.hook_del(hook)
        self.hooks.clear()
