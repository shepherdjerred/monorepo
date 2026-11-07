"""Read original packed Ray packets for diagnostic projection/sampling only."""
import struct
import numpy as np


def ray_packet_arrays(draw):
    if draw.get('primitive') != 'ray' or type(draw.get('particleCount')) is not int or not 1 <= draw['particleCount'] <= 1024:
        raise ValueError('Positive bounded native Ray packet required')
    vertices = bytes.fromhex(draw['geometry']['verticesHex'])
    index_bytes = bytes.fromhex(draw['geometry']['indicesHex'])
    count = draw['particleCount'] * 4
    if len(vertices) != count * 28 or len(index_bytes) != draw['particleCount'] * 12:
        raise ValueError('Complete 28-byte Ray vertices/indices required')
    positions = np.array([struct.unpack_from('<3f', vertices, i * 28) for i in range(count)])
    colors = np.array([struct.unpack_from('<4B', vertices, i * 28 + 12) for i in range(count)], dtype=float) / 255
    indices = np.frombuffer(index_bytes, dtype='<u2')
    if not np.all(np.isfinite(positions)) or np.any(indices >= count):
        raise ValueError('Finite in-bounds native Ray geometry required')
    return positions, colors, indices
