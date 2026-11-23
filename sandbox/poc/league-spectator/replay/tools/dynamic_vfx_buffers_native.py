"""Narrow device allocation port for the observed original VFX dynamic wrapper.

Static buffers keep their existing byte-verified producer and gate. This port
admits the original 0x1917b80 wrapper and 0x1744960 pool's null-source allocations,
executing the same complete original CPU header constructors as static ports.
"""
from unicorn import x86_const as r
from graphics_dynamic_buffer_device import GraphicsDynamicBufferDevice
from vfx_graphics_native import DEVICE
from vfx_mesh_native import BUFFER_RETURN


class NativeDynamicVfxBuffers:
    def initialize_character_graphics(self, angle):
        result = super().initialize_character_graphics(angle)
        self.dynamic_buffer_device = GraphicsDynamicBufferDevice(self.device)
        result['dynamicBufferProvider'] = 'owned-gles-null-source-allocation-only'
        return result

    def buffer_create(self, engine, address, size, user):
        count, flags, pointer = [engine.reg_read(register) for register in
                                 [r.UC_X86_REG_RSI, r.UC_X86_REG_RDX, r.UC_X86_REG_RCX]]
        if flags not in [1, 3] or pointer != 0:
            return super().buffer_create(engine, address, size, user)
        stack = engine.reg_read(r.UC_X86_REG_RSP)
        caller = self.q(stack)-self.base
        start, end = (0x1917b99, 0x1917baf) if caller == 0x1917baf else (0x17449a5, 0x17449bc)
        if (engine.reg_read(r.UC_X86_REG_RDI) != DEVICE or caller not in [0x1917baf, 0x17449bc] or
                self.pending_mesh_buffer is not None or not 0 < count <= 8*1024*1024 or
                self.image[start:end] != self.source.image[start:end] or
                not hasattr(self, 'dynamic_buffer_device')):
            raise ValueError('Unadmitted original VFX null-source dynamic-buffer request')
        if caller == 0x1917baf:
            if flags != 3 or count >= 0x100000:
                raise ValueError('Original dynamic wrapper flags/capacity differ')
        else:
            self.validate_dynamic_vfx_pool(engine.reg_read(r.UC_X86_REG_RBX), count, flags, False)
        gpu = self.dynamic_buffer_device.create_uninitialized(count, flags)
        header = self.allocate(0x48, 0xa5)
        self.pending_mesh_buffer = {'gpu': gpu, 'header': header, 'stack': stack,
                                    'returnRva': caller, 'sourcePointer': pointer}
        frame = stack-0x10
        self.put(frame, 'Q', BUFFER_RETURN)
        for register, value in {r.UC_X86_REG_RDI: header, r.UC_X86_REG_RSI: count,
                                r.UC_X86_REG_RDX: flags, r.UC_X86_REG_RSP: frame,
                                r.UC_X86_REG_RIP: self.base+0x1917a40}.items():
            engine.reg_write(register, value)

    def validate_dynamic_vfx_pool(self, pool, count, flags, index):
        if not self.library_pointer(pool, 0x48):
            raise ValueError('Original dynamic VFX pool escaped owned storage')
        capacity = self.u32(pool+0xc)
        if (flags != 1 or not 0 < capacity <= 65536 or self.u32(pool+4) != capacity*0x70 or
                self.u32(pool+8) != capacity*6 or count != capacity*(12 if index else 0x70)):
            raise ValueError('Original dynamic VFX pool dimensions/flags differ')

    def index_buffer_create(self, engine, address, size, user):
        count, format_, flags, pointer = [engine.reg_read(register) for register in
                                          [r.UC_X86_REG_RSI, r.UC_X86_REG_RDX,
                                           r.UC_X86_REG_RCX, r.UC_X86_REG_R8]]
        if flags != 1 or pointer != 0:
            return super().index_buffer_create(engine, address, size, user)
        stack = engine.reg_read(r.UC_X86_REG_RSP)
        start, end = 0x17449c5, 0x17449e1
        if (engine.reg_read(r.UC_X86_REG_RDI) != DEVICE or self.q(stack)-self.base != end or
                self.pending_index_buffer is not None or format_ != 0 or
                self.image[start:end] != self.source.image[start:end]):
            raise ValueError('Unadmitted original VFX null-source index-buffer request')
        self.validate_dynamic_vfx_pool(engine.reg_read(r.UC_X86_REG_RBX), count, flags, True)
        gpu = self.dynamic_buffer_device.create_uninitialized(count, flags, kind='index')
        gpu.update(indexBytes=2, nativeIndexFormat=format_)
        header = self.allocate(0x48, 0xa5)
        self.pending_index_buffer = {'gpu': gpu, 'header': header, 'stack': stack}
        frame = stack-16
        self.put(frame, 'Q', self.index_callbacks['return'])
        for register, value in {r.UC_X86_REG_RSP: frame, r.UC_X86_REG_RDI: header,
                                r.UC_X86_REG_RSI: count, r.UC_X86_REG_RDX: format_, r.UC_X86_REG_RCX: flags,
                                r.UC_X86_REG_RIP: self.base+0x1916ae0}.items():
            engine.reg_write(register, value)

    def index_buffer_return(self, engine, address, size, user):
        pending = self.pending_index_buffer
        if pending is None or pending['gpu']['kind'] != 'dynamic-uninitialized-index':
            return super().index_buffer_return(engine, address, size, user)
        gpu, header = pending['gpu'], pending['header']
        if (self.u32(header+8) or self.u32(header+12) != gpu['bytes'] or
                bytes(engine.mem_read(header+16, 2)) != bytes([0, gpu['flags']])):
            raise ValueError('Original dynamic index-buffer CPU header differs')
        gpu.update(nativePointer=header, nativeHeaderHex=bytes(engine.mem_read(header, 0x48)).hex(),
                   originalHeaderConstructorRva=0x1916ae0)
        self.native_index_buffers[header] = gpu
        engine.reg_write(r.UC_X86_REG_RSP, pending['stack'])
        engine.reg_write(r.UC_X86_REG_RAX, header)
        self.pending_index_buffer = None
        self.ret()

    def close_graphics(self):
        dynamic = getattr(self, 'dynamic_buffer_device', None)
        if dynamic is not None:
            dynamic.close()
        return super().close_graphics()
