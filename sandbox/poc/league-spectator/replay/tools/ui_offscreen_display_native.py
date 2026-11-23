"""Exact UI-call ABI for querying the owned EGL pbuffer's actual extent.

This is an offscreen platform adapter, not a native window or a replacement for
the game's viewport producer. Native layout consumes the returned surface size.
EGL 1.5 section 3.5.6 defines these queries and their failure behavior.
https://registry.khronos.org/EGL/specs/eglspec.1.5.pdf
"""
import ctypes as C
import struct

from unicorn import x86_const as r
from vfx_graphics_native import SERVICE, SERVICE_VTABLE


def query_surface_dimension(device, attribute):
    if attribute not in [0x3057, 0x3056] or not device.display or not device.surface:
        raise ValueError("Owned EGL surface and explicit width/height query required")
    egl = device.egl
    if egl.eglGetError() != 0x3000:
        raise ValueError("EGL already has an error before UI surface query")
    value = C.c_int(-1)
    success = egl.eglQuerySurface(device.display, device.surface, attribute, C.byref(value))
    error = egl.eglGetError()
    if success != 1 or error != 0x3000 or value.value <= 0:
        raise ValueError(f"UI eglQuerySurface failed: success={success}, error={error:#x}, value={value.value}")
    return value.value


class UiOffscreenDisplay:
    def __init__(self, n):
        self.n, self.device, self.records = n, n.device, []
        if self.device is None or n.q(SERVICE) != SERVICE_VTABLE or n.q(n.base + 0x256E1B8) != SERVICE:
            raise ValueError("Existing owned graphics facade required for UI surface adapter")
        self.display, self.surface = self.device.display, self.device.surface
        self.device.fn(self.device.egl, 'eglQuerySurface', C.c_uint,
            C.c_void_p, C.c_void_p, C.c_int, C.POINTER(C.c_int))
        self.methods = {}
        for slot, getter, callers, attribute in [
                (0x50, 0x192F200, (0x188B638,), 0x3057),
                (0x58, 0x192F210, (0x188B649, 0x665FEE), 0x3056)]:
            expected = '554889e58b4768' if slot == 0x50 else '554889e58b476c'
            if (n.image[getter:getter + 7] != bytes.fromhex(expected) or
                    struct.unpack_from('<Q', n.image, 0x2408908 + slot)[0] != n.base + getter or
                    any(n.image[caller - 3:caller] != bytes([0xff, 0x51, slot]) for caller in callers) or
                    n.q(SERVICE_VTABLE + slot) != 0):
                raise ValueError("Original graphics facade dimension ABI or unused adapter slot changed")
            def callback(engine, address, size, user, call=callers, attr=attribute, native=getter):
                self.read(engine, call, attr, native)
            entry = n.allocate_native_callback(f'ui-offscreen-surface:{slot:x}', callback)
            n.put(SERVICE_VTABLE + slot, 'Q', entry)
            self.methods[slot] = entry

    def read(self, engine, callers, attribute, getter):
        n = self.n
        stack = engine.reg_read(r.UC_X86_REG_RSP)
        caller = n.q(stack) - n.base
        if (not getattr(n, 'ui_manager_startup_active', False) or
                engine.reg_read(r.UC_X86_REG_RDI) != SERVICE or
                n.q(SERVICE) != SERVICE_VTABLE or caller not in callers or
                n.device is not self.device or self.device.display != self.display or
                self.device.surface != self.surface):
            raise ValueError("UI surface query has no exact original caller/owned display")
        value = query_surface_dimension(self.device, attribute)
        self.records.append({'originalGetterRva': getter, 'originalCallerRva': caller,
            'attribute': attribute, 'value': value, 'source': 'eglQuerySurface-owned-pbuffer'})
        engine.reg_write(r.UC_X86_REG_RAX, value)
        n.ret()
