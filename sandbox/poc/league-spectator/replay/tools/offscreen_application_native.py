"""Explicit inactive, windowless platform port for scoped original controls.

No host foreground window, cursor, events, or League process is accessed. The
current thread is independently required to have no active window. Platform
tokens are not game owners; cursor requests affect only this offscreen model.
Unknown callers/selectors fail. No AppKit/device startup readiness is implied.

https://developer.apple.com/documentation/appkit/nsapplication/isactive
https://developer.apple.com/documentation/appkit/nscursor
https://developer.apple.com/documentation/coregraphics/cgerror/invalidconnection
https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getactivewindow
"""
import ctypes
import os
from contextlib import contextmanager
import unicorn
from unicorn import x86_const as r
from macho_pointer_bindings import pointer_bindings
from vfx_spawn_native import sha


def check_windowless_thread():
    if os.name != 'nt':
        raise ValueError('This explicit offscreen platform control requires a Windows host')
    query = ctypes.WinDLL('user32', use_last_error=True).GetActiveWindow
    query.argtypes, query.restype = [], ctypes.c_void_p
    window = query()
    if window:
        raise ValueError('Offscreen native control thread unexpectedly owns an active window')
    return {'api': 'GetActiveWindow', 'currentThreadActiveWindow': 0, 'foregroundWindowQueried': False}


class NativeOffscreenApplication:
    def imported(self, engine, address, size, user):
        state = getattr(self, 'offscreen_application', None)
        name = self.source.imports[address-self.base]
        if state is not None and name in ['_NXOpenEventStatus', '_NXCloseEventStatus', '_CGAssociateMouseAndMouseCursorPosition']:
            if name == '_NXOpenEventStatus':
                if self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base != 0x15e4457:
                    raise ValueError('Unowned offscreen event-status caller')
                if state.get('nullEventStatusOpen'):
                    raise ValueError('Unclosed original offscreen event-status attempt')
                state['nullEventStatusOpen'] = True
                result = 0  # MACH_PORT_NULL: this port has no native event device.
            elif name == '_NXCloseEventStatus':
                if (self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base != 0x15e46c0 or
                        engine.reg_read(r.UC_X86_REG_RDI) or not state.pop('nullEventStatusOpen', False)):
                    raise ValueError('Unowned offscreen null event-status close')
                result = 0  # void, no event device was created or successfully closed.
            else:
                argument = engine.reg_read(r.UC_X86_REG_RDI)
                if not state.pop('associatePermit', False) or argument != 1:
                    raise ValueError('Unowned offscreen mouse-association caller/argument')
                result = 1002  # kCGErrorInvalidConnection, not a successful device call.
            state['platformCalls'].append({'name': name, 'result': result})
            engine.reg_write(r.UC_X86_REG_RAX, result)
            self.ret()
            return
        return super().imported(engine, address, size, user)


@contextmanager
def original_offscreen_application(n, result):
    if getattr(n, 'offscreen_application', None) is not None:
        raise ValueError('Offscreen application platform ownership is not reentrant')
    host = check_windowless_thread()
    bindings = pointer_bindings(n.source.binary)
    if (bindings.get(n.base+0x246b718) != {'symbol': '_OBJC_CLASS_$_NSCursor', 'addend': 0} or
            bindings.get(n.base+0x22e0018) != {'symbol': '_NSApp', 'addend': 0} or
            n.source.data_imports.get(0x22e0408) != '_objc_msgSend'):
        raise ValueError('Original AppKit class/data bindings differ')
    spans = [(0x15e1080, 0x15e114b), (0x15e4430, 0x15e4461)]
    for start, end in spans:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original offscreen application consumer source differs')
    mapped = [n.base+offset for offset in [0x22e0018, 0x22e0408, 0x246b718]]
    previous = [n.q(at) for at in mapped]
    if any(previous):
        raise ValueError('An existing platform AppKit binding must not be replaced')
    tokens = {name: n.allocate(16) for name in ['app', 'cursorClass', 'arrowCursor', 'appCell', 'message']}
    state = {'platformCalls': [], 'messages': [], 'hostCursorAccessed': False,
             'active': False, 'currentCursor': None}
    result.update(host=host, kind='inactive-windowless-platform-control',
                  bindings={'cursorClass': bindings[n.base+0x246b718], 'application': bindings[n.base+0x22e0018]},
                  sources=[{'startRva': start, 'endRva': end, 'sha256': sha(n.image[start:end])}
                           for start, end in spans],
                  platformState=state, actualAppKitStarted=False, hostEventsAccessed=False,
                  nativeGameReadinessAdmitted=False)
    def message(engine, address, size, user):
        receiver = engine.reg_read(r.UC_X86_REG_RDI)
        selector = n.cstring(engine.reg_read(r.UC_X86_REG_RSI)).decode('ascii')
        caller = n.q(engine.reg_read(r.UC_X86_REG_RSP))-n.base
        if (receiver, selector, caller) == (tokens['app'], 'isActive', 0x15e10ca):
            check_windowless_thread()
            value = 0
        elif (receiver, selector, caller) == (tokens['cursorClass'], 'unhide', 0x15e111a):
            value = 0  # void; there is no offscreen cursor display to expose.
        elif (receiver, selector, caller) == (tokens['cursorClass'], 'arrowCursor', 0x15e112a):
            value = tokens['arrowCursor']
        elif (receiver, selector, caller) == (tokens['arrowCursor'], 'set', 0x15e1136):
            state['currentCursor'] = 'arrow'
            value = 0  # void; update the port-owned offscreen state only.
        else:
            raise ValueError(f'Unsupported offscreen AppKit message: {selector} caller={caller:x}')
        state['messages'].append({'selector': selector, 'callerRva': caller, 'result': value})
        engine.reg_write(r.UC_X86_REG_RAX, value)
        n.ret()
    def permit_association(engine, address, size, user):
        if state.get('associatePermit'):
            raise ValueError('Unconsumed offscreen mouse-association ownership')
        state['associatePermit'] = True
    n.u.mem_write(tokens['message'], b'\xc3')
    hooks = []
    n.offscreen_application = state
    try:
        hooks.append(n.u.hook_add(unicorn.UC_HOOK_CODE, message, begin=tokens['message'], end=tokens['message']))
        hooks.append(n.u.hook_add(unicorn.UC_HOOK_CODE, permit_association,
                                 begin=n.base+0x15e1146, end=n.base+0x15e1146))
        n.put(tokens['appCell'], 'Q', tokens['app'])
        for at, value in zip(mapped, [tokens['appCell'], tokens['message'], tokens['cursorClass']]):
            n.put(at, 'Q', value)
        yield
        check_windowless_thread()
        if state.get('associatePermit') or state.get('nullEventStatusOpen'):
            raise ValueError('Original offscreen mouse-association call did not consume ownership')
    finally:
        for at, value in zip(mapped, previous):
            n.put(at, 'Q', value)
        for hook in hooks:
            n.u.hook_del(hook)
        n.offscreen_application = None
        result['platformBindingsRestored'] = all(n.q(at) == value for at, value in zip(mapped, previous))
