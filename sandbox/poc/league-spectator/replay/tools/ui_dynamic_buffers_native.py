"""Original UI batch owner's narrowly bounded null-source index allocation.

The generic vertex wrapper uses the existing source-gated provider unchanged.
This adds only the observed original UI constructor's index-buffer request;
initial device bytes remain undefined until original uploads are executed.
"""
from unicorn import x86_const as r
from dynamic_vfx_buffers_native import NativeDynamicVfxBuffers
from vfx_graphics_native import DEVICE
from vfx_spawn_native import ADDRESSES


def validate_ui_index_request(n, engine):
    count, format_, flags, pointer = [engine.reg_read(register) for register in
        [r.UC_X86_REG_RSI, r.UC_X86_REG_RDX, r.UC_X86_REG_RCX, r.UC_X86_REG_R8]]
    stack = engine.reg_read(r.UC_X86_REG_RSP)
    frame = engine.reg_read(r.UC_X86_REG_RBP)
    owner = engine.reg_read(r.UC_X86_REG_R15) - 0x70
    if (not getattr(n, "ui_manager_startup_active", False) or
            engine.reg_read(r.UC_X86_REG_RDI) != DEVICE or n.q(stack) - n.base != 0x1917B19 or
            not ADDRESSES["stack"] - 0x8000 <= frame <= ADDRESSES["stack"] - 16 or
            n.q(frame + 8) - n.base != 0x1899D60 or
            n.allocations.get(owner) != 0xD0 or n.pending_index_buffer is not None or
            count != 0x20000 or format_ != 0 or flags != 3 or pointer != 0 or
            n.image[0x1917AE0:0x1917B19] != n.source.image[0x1917AE0:0x1917B19] or
            n.image[0x1899D4D:0x1899D60] != n.source.image[0x1899D4D:0x1899D60]):
        raise ValueError("Unadmitted original UI batch index-buffer request")
    return {"owner": owner, "bytes": count, "format": format_, "flags": flags, "stack": stack,
            "sourcePointer": pointer, "wrapperReturnRva": 0x1917B19, "originalOwnerReturnRva": 0x1899D60}


class NativeUiDynamicBuffers(NativeDynamicVfxBuffers):
    def index_buffer_create(self, engine, address, size, user):
        if (not getattr(self, "ui_manager_startup_active", False) or
                self.q(engine.reg_read(r.UC_X86_REG_RSP)) - self.base != 0x1917B19):
            return super().index_buffer_create(engine, address, size, user)
        request = validate_ui_index_request(self, engine)
        gpu = self.dynamic_buffer_device.create_uninitialized(request["bytes"], request["flags"], kind="index")
        gpu.update(indexBytes=2, nativeIndexFormat=request["format"], originalUiRequest=request)
        header = self.allocate(0x48, 0xA5)
        self.pending_index_buffer = {"gpu": gpu, "header": header, "stack": request["stack"]}
        frame = request["stack"] - 16
        self.put(frame, "Q", self.index_callbacks["return"])
        for register, value in {r.UC_X86_REG_RSP: frame, r.UC_X86_REG_RDI: header,
                r.UC_X86_REG_RSI: request["bytes"], r.UC_X86_REG_RDX: request["format"],
                r.UC_X86_REG_RCX: request["flags"], r.UC_X86_REG_RIP: self.base + 0x1916AE0}.items():
            engine.reg_write(register, value)
