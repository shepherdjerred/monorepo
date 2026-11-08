import unittest
import struct
from diagnostic_ray_packet import ray_packet_arrays


class DiagnosticRayPacketTests(unittest.TestCase):
    def fixture(self):
        vertices = b''.join(struct.pack('<3f4B6H', i, i + 1, -i, 11, 22, 33, 255, *[0]*6) for i in range(8))
        indices = struct.pack('<12H', 0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7)
        return {'primitive': 'ray', 'particleCount': 2,
                'geometry': {'verticesHex': vertices.hex(), 'indicesHex': indices.hex()}}

    def test_original_stride_without_draw_positions_or_colors(self):
        draw = self.fixture()
        positions, colors, indices = ray_packet_arrays(draw)
        self.assertEqual(positions.tolist(), [[i, i+1, -i] for i in range(8)])
        self.assertEqual(colors[7].tolist(), [11/255, 22/255, 33/255, 1])
        self.assertEqual(indices.tolist(), [0,1,2,0,2,3,4,5,6,4,6,7])
        self.assertNotIn('positions', draw)

    def test_rejects_truncated_foreign_and_out_of_bounds_packets(self):
        for field, value in [('primitive','camera-quad'), ('particleCount',True), ('particleCount',0)]:
            draw = self.fixture(); draw[field] = value
            with self.assertRaises(ValueError): ray_packet_arrays(draw)
        draw = self.fixture(); draw['geometry']['verticesHex'] = draw['geometry']['verticesHex'][:-2]
        with self.assertRaises(ValueError): ray_packet_arrays(draw)
        draw = self.fixture(); draw['geometry']['indicesHex'] = 'ffff' + draw['geometry']['indicesHex'][4:]
        with self.assertRaises(ValueError): ray_packet_arrays(draw)
        draw = self.fixture(); draw['geometry']['verticesHex'] = struct.pack('<f', float('nan')).hex() + draw['geometry']['verticesHex'][8:]
        with self.assertRaises(ValueError): ray_packet_arrays(draw)


if __name__ == '__main__': unittest.main()
