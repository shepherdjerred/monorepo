"""Original shader/material decisions on complete CameraTrail objects."""
from vfx_material_native import NativeVfxMaterial, PROGRAM, MATERIAL
from vfx_spawn_native import ADDRESSES as A


class NativeTrailMaterial(NativeVfxMaterial):
    def prepare_trail_material(self, graph):
        if (graph['build'] != '16.21.829.8620' or graph['protocol'] != '20e09df23c66b85e' or
                graph['primitiveKind'] != 'camera-trail'):
            raise ValueError('Unsupported trail material graph')
        self.u.mem_write(0x10400000, self.material_baseline_arena)
        self.load([])
        self.loading = True
        self.library_calls.clear()
        self.math_calls.clear()
        for segment in graph['segments']:
            start, raw = segment['address'], bytes.fromhex(segment['bytesHex'])
            if not (start == A['definition'] and len(raw) == 0x10000 or
                    start == graph['assetHeapStart'] and len(raw) == graph['assetHeapBytes'] and
                    0x10400000 <= start <= start + len(raw) < 0x11000000):
                raise ValueError('Trail material asset exceeds ownership bounds')
            self.u.mem_write(start, raw)
        self.next_heap = graph['nextHeap']
        if self.next_heap != graph['assetHeapStart'] + graph['assetHeapBytes']:
            raise ValueError('Trail material heap endpoint differs')
        self.root_before = bytes(self.u.mem_read(A['definition'], 0x470))
        if self.root_before.hex() != graph['assetObjectHex']:
            raise ValueError('Trail material root changed')
        primitive = self.q(A['definition'] + 0x60)
        if self.q(primitive) != self.base + 0x23f6520:
            raise ValueError('Trail material primitive changed')
        if self.q(A['definition'] + 0x68):
            raise ValueError('Custom trail material requires its original factory')
        self.heap_before = bytes(self.u.mem_read(graph['assetHeapStart'], graph['assetHeapBytes']))
        self.graph = graph
        self.u.mem_write(PROGRAM, bytes(0x600))
        self.put(A['link'] + 8, 'Q', A['resource'])
        self.put(A['resource'] + 0x38, 'Q', A['systemDefinition'])
        self.put(self.base + 0x246dfd0, 'Q', A['manager'])
        self.put(A['link'] + 0x88, 'Q', MATERIAL)
        self.record_material = True
