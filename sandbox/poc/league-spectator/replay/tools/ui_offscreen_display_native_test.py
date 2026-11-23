"""Surface query failures never become successful native viewport values."""
import unittest
from types import SimpleNamespace

from unicorn import x86_const as r
from ui_offscreen_display_native import UiOffscreenDisplay, query_surface_dimension
from vfx_graphics_native import SERVICE, SERVICE_VTABLE


class Egl:
    def __init__(self, success=1, value=147, errors=(0x3000, 0x3000)):
        self.success, self.value, self.errors, self.calls = success, value, iter(errors), 0

    def eglGetError(self):
        return next(self.errors)

    def eglQuerySurface(self, display, surface, attribute, out):
        self.calls += 1
        out._obj.value = self.value
        return self.success


class DisplayTests(unittest.TestCase):
    def device(self, **kwargs):
        return SimpleNamespace(egl=Egl(**kwargs), display=17, surface=23)

    def test_exact_query_value_is_returned(self):
        device = self.device()
        self.assertEqual(query_surface_dimension(device, 0x3057), 147)
        self.assertEqual(device.egl.calls, 1)

    def test_failed_or_invalid_queries_reject(self):
        for kwargs in [{'success': 0}, {'value': 0}, {'value': -1},
                {'errors': (0x3000, 0x300D)}, {'errors': (0x3001,)}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                query_surface_dimension(self.device(**kwargs), 0x3056)
        device = self.device()
        with self.assertRaisesRegex(ValueError, 'explicit width/height'):
            query_surface_dimension(device, 0x1234)
        self.assertEqual(device.egl.calls, 0)

    def test_unrelated_native_caller_never_queries_egl(self):
        adapter = UiOffscreenDisplay.__new__(UiOffscreenDisplay)
        adapter.device = self.device()
        adapter.display, adapter.surface = 17, 23
        adapter.records = []
        engine = SimpleNamespace(reg_read=lambda reg: SERVICE if reg == r.UC_X86_REG_RDI else 0x1000)
        adapter.n = SimpleNamespace(base=0x100000000, device=adapter.device,
            ui_manager_startup_active=True,
            q=lambda address: SERVICE_VTABLE if address == SERVICE else 0x100000001)
        with self.assertRaisesRegex(ValueError, 'exact original caller'):
            adapter.read(engine, (0x188B638,), 0x3057, 0x192F200)
        self.assertEqual(adapter.device.egl.calls, 0)
        self.assertEqual(adapter.records, [])


if __name__ == '__main__':
    unittest.main()
