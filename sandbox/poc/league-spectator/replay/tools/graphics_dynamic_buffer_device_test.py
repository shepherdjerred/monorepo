import ctypes as C
import unittest
from graphics_dynamic_buffer_device import GraphicsDynamicBufferDevice


class GL:
    def __init__(self):
        self.calls, self.capacity, self.deleted = [], 0, []
        self.reported_capacity = None

    def glGetError(self):
        return 0

    def glGenBuffers(self, count, output):
        C.cast(output, C.POINTER(C.c_uint))[0] = 7

    def glBindBuffer(self, target, handle):
        self.calls.append(('bind', target, handle.value))

    def glBufferData(self, target, count, source, usage):
        self.calls.append(('allocate', target, count, source, usage))
        self.capacity = count

    def glGetBufferParameteriv(self, target, selector, output):
        C.cast(output, C.POINTER(C.c_int))[0] = self.capacity if self.reported_capacity is None else self.reported_capacity

    def glDeleteBuffers(self, count, pointer):
        self.deleted.append(C.cast(pointer, C.POINTER(C.c_uint))[0])


class Device:
    def __init__(self):
        self.gl = GL()

    def fn(self, *args):
        pass


class Controls(unittest.TestCase):
    def test_null_source_capacity_is_checked_without_fabricated_initialized_bytes(self):
        device = Device()
        backend = GraphicsDynamicBufferDevice(device)
        record = backend.create_uninitialized(1792000, 1)
        self.assertEqual(device.gl.calls[-1], ('allocate', 0x8892, 1792000, None, 0x88e8))
        self.assertTrue(record['deviceCapacityVerified'])
        self.assertEqual(record['initialBytesStatus'], 'undefined-null-source')
        self.assertFalse(record['gpuBytesVerified'])
        self.assertFalse(record['nativeWritesUploaded'])
        self.assertNotIn('bytesHex', record)
        backend.close()
        backend.close()
        self.assertEqual(device.gl.deleted, [7])

    def test_invalid_requests_and_total_live_budget_precede_allocation(self):
        for count, flags, kind in [(0, 1, 'vertex'), (True, 1, 'vertex'), (8388609, 1, 'vertex'),
                                    (1024, 2, 'vertex'), (1024, 1, 'unknown')]:
            device = Device()
            backend = GraphicsDynamicBufferDevice(device)
            with self.assertRaisesRegex(ValueError, 'Bounded dynamic'):
                backend.create_uninitialized(count, flags, kind=kind)
            self.assertEqual(device.gl.calls, [])
        device = Device()
        backend = GraphicsDynamicBufferDevice(device)
        backend.records = [{'bytes': 32*1024*1024}]
        with self.assertRaisesRegex(ValueError, 'Bounded dynamic'):
            backend.create_uninitialized(4, 1)
        self.assertEqual(device.gl.calls, [])

    def test_device_capacity_disagreement_fails_and_storage_still_releases(self):
        device = Device()
        device.gl.reported_capacity = 12
        backend = GraphicsDynamicBufferDevice(device)
        with self.assertRaisesRegex(ValueError, 'capacity differs'):
            backend.create_uninitialized(16, 3)
        self.assertEqual(backend.records, [])
        backend.close()
        self.assertEqual(device.gl.deleted, [7])


if __name__ == '__main__':
    unittest.main()
