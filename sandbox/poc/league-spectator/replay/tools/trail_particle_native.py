"""Camera trails from complete post-loaded emitters, without field projection.

The original pool update and CameraTrail writer run on supplied scene inputs.
Terrain queries and child effect factories remain explicit admission boundaries.
"""
import struct

from unicorn import x86_const as r
from vfx_bound_quad_native import NativeBoundQuad, TEXTURE_PRESENCE
from vfx_loaded_quad_native import LoadedQuadAdmissionError
from vfx_spawn_native import ADDRESSES as A
from vfx_emitter_native import GEOMETRY as G


class NativeTrailParticles(NativeBoundQuad):
    def prepare_trail(self, state):
        obj, heap = bytes.fromhex(state['objectHex']), bytes.fromhex(state['heapHex'])
        start = state['heapStart']
        end = start + len(heap)
        if (state['phase'] != 'native-postload-callbacks-executed' or
                state['pendingLinkFixups'] or state['mathCalls'] or len(obj) != 0x470 or
                not 0x10400000 <= start <= end < 0x12000000 or end % 16):
            raise ValueError('Invalid complete trail asset')
        primitive = struct.unpack_from('<Q', obj, 0x60)[0]
        if not any(v['object'] == primitive and v['type'] == 678973881 for v in state['visits']):
            raise LoadedQuadAdmissionError('Primitive is not a CameraTrail')
        if obj[0x2d1] & 8:
            raise LoadedQuadAdmissionError('Terrain-following trail requires the native height context')
        if struct.unpack_from('<Q', obj, 0x3c8)[0]:
            raise LoadedQuadAdmissionError('Child trail effects require the native effect factory')
        # Reuse only the established owned scene environment. The complete root
        # and heap replace its spare definition before the actual constructor.
        graph = self.prepare_quad({'__type': 'VfxEmitterDefinitionData',
            'SpawnShape': {'__type': 'VfxShapeLegacy'},
            'primitive': {'__type': 'VfxPrimitiveArbitraryQuad'}})
        self.u.mem_write(A['definition'], obj)
        self.u.mem_write(0x10400000, bytes(end - 0x10400000))
        self.u.mem_write(start, heap)
        if self.q(primitive) != self.base + 0x23f6520:
            raise ValueError('CameraTrail primitive vtable differs')
        uv = self.classify_uv()
        if bytes(self.u.mem_read(A['definition'], 0x470)) != obj:
            raise ValueError('Trail UV classification mutated the asset')
        graph.update({'allocations': [], 'nextHeap': end,
            'segments': [{'address': A['definition'],
                'bytesHex': bytes(self.u.mem_read(A['definition'], 0x10000)).hex()},
                {'address': start, 'bytesHex': heap.hex()}],
            'assetHeapStart': start, 'assetHeapBytes': len(heap), 'assetObjectHex': obj.hex(),
            'primitiveAddress': primitive, 'primitiveKind': 'camera-trail', 'uvFlags': uv,
            'hasMultDefinition': bool(struct.unpack_from('<Q', obj, 0x230)[0]),
            'authoredFields': [], 'presentationMetadataOnly': [],
            'ownedInputs': 'Complete unchanged post-loaded CameraTrail asset. Original pool birth/update/removal, UV classification and trail writer. Supplied unit scene scales/colors, clock, actor basis, camera axis, seed, quality and mult-texture presence. Absent flex channels. Constructor stops before material acquisition. Terrain and child factories rejected; full effect activation and original scene bindings remain unresolved.'})
        return graph

    def render_quad(self, view_position):
        self.u.mem_write(G['context'], bytes(0x3000))
        for offset, pointer in [(0, G['indices']), (8, G['vertices']),
                (0x10, G['draw']), (0x18, A['actor']), (0x20, G['view'])]:
            self.put(G['context'] + offset, 'Q', pointer)
        self.put(G['view'], 'fff', *view_position)
        self.put(G['view'] + 0x24, 'fff', *self.view_axis)
        primitive = self.q(A['definition'] + 0x60)
        if self.q(primitive) != self.base + 0x23f6520:
            raise ValueError('Loaded trail primitive changed')
        self.math_calls.clear()
        self.call(0x1737570, {r.UC_X86_REG_RDI: primitive, r.UC_X86_REG_RSI: G['context']})
        nv = self.q(G['context'] + 8) - G['vertices']
        ni = self.q(G['context']) - G['indices']
        count = struct.unpack('<I', self.u.mem_read(self.q(A['actor'] + 0xa0) + 0x10, 4))[0]
        if not (count <= 1024 and 0 <= nv <= count * 56 and
                0 <= ni <= max(0, count - 1) * 12 and nv % 28 == ni % 2 == 0):
            raise ValueError('Native trail output exceeds owned geometry')
        return {'verticesHex': bytes(self.u.mem_read(G['vertices'], nv)).hex(),
            'indicesHex': bytes(self.u.mem_read(G['indices'], ni)).hex(),
            'drawHex': bytes(self.u.mem_read(G['draw'], 16)).hex(),
            'mathCalls': list(self.math_calls)}
