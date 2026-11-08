"""Native material components for complete post-loaded attached-mesh assets.

The authored primitive stays type 11. This supplies material/resource predicates;
it does not execute mesh pose binding, resource acquisition or graphics submission.
The existing quad helper and its frozen observations remain unchanged.
"""
import struct
from vfx_material_native import NativeVfxMaterial, PROGRAM, MATERIAL
from vfx_spawn_native import ADDRESSES as A
MESH_RESOURCE = 0x100e5000


class NativeAttachedMaterial(NativeVfxMaterial):
    def prepare_attached(self, state):
        obj, heap = bytes.fromhex(state['objectHex']), bytes.fromhex(state['heapHex'])
        start = state['heapStart']
        if (state['phase'] != 'native-postload-callbacks-executed' or
                state['pendingLinkFixups'] or state['mathCalls'] or len(obj) != 0x470 or
                start != self.baseline_heap or not start <= start + len(heap) < 0x11000000):
            raise ValueError('Invalid complete attached material state')
        primitive = struct.unpack_from('<Q', obj, 0x60)[0]
        if not any(v['object'] == primitive and v['type'] == 0xa4aea2a5 for v in state['visits']):
            raise ValueError('Material primitive is not an authored attached mesh')
        self.u.mem_write(0x10400000, self.material_baseline_arena)
        self.load([])
        self.loading = True
        self.library_calls.clear()
        self.math_calls.clear()
        self.u.mem_write(A['definition'], obj)
        self.u.mem_write(start, heap)
        self.next_heap = start + len(heap)
        if self.q(primitive) != self.base + 0x23f6d30 or self.u.mem_read(primitive + 8, 1) != b'\x0b':
            raise ValueError('Attached material native primitive changed')
        if self.q(A['definition'] + 0x68):
            raise ValueError('Custom material requires original custom-material factory')
        self.root_before, self.heap_before = obj, heap
        self.graph = {'assetHeapStart':start, 'assetHeapBytes':len(heap)}
        self.u.mem_write(PROGRAM, bytes(0x600))
        self.put(A['link'] + 0x10, 'Q', A['definition'])
        self.put(A['link'] + 0x28, 'Q', 0)
        self.put(A['link'] + 0x30, 'I', 0xffffffff)
        self.put(A['link'] + 8, 'Q', A['resource'])
        self.put(A['resource'] + 0x38, 'Q', A['systemDefinition'])
        self.put(self.base + 0x246dfd0, 'Q', A['manager'])
        self.put(A['link'] + 0x88, 'Q', MATERIAL)
        self.record_material = True

    def select_attached(self, values, resolved_resource_flag95):
        # The original attached branch either reads a resolved resource's byte
        # +0x95 or looks it up by a cache handle. Only the resolved/absent input
        # boundary is exercised here. Cache lookup and resource construction are
        # not reconstructed. Keep the raw field name until its producer is traced.
        if resolved_resource_flag95 is not None and type(resolved_resource_flag95) is not bool:
            raise ValueError('Explicit absent/resource-byte-95 predicate required')
        self.u.mem_write(MESH_RESOURCE, bytes(0x100))
        self.put(A['link'] + 0x28, 'Q', 0 if resolved_resource_flag95 is None else MESH_RESOURCE)
        self.put(MESH_RESOURCE + 0x95, 'B', bool(resolved_resource_flag95))
        return self.select(values)
