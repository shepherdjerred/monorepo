"""Bounded GLES material-uniform updates at the observed original callsite.

The original Metal adapter's derived objects are not used by this GLES port.
This updates the already owned GLES buffers and verifies their bytes; Metal
dirty flags, scene-data buffers and rendering are separate capabilities.
"""
import ctypes as C
import hashlib
from xxhash import xxh32_intdigest
from unicorn import x86_const as r
import unicorn
from vfx_graphics_native import DEVICE
from vfx_pipeline_native import PIPELINE_DEVICE_VTABLE

UPDATE_CALLBACK = 0x100f3600
MAX_BUFFER_BYTES = 1048576


def validate_parameter(name, count):
    if (not isinstance(name, str) or '\0' in name or len(name.encode()) > 4095 or
            type(count) is not int or not 0 <= count <= 0xffffffff):
        raise ValueError('Bounded material parameter name and vector count required')


def material_uniform_copy(data, rows, name, count, source):
    validate_parameter(name, count)
    if (not isinstance(data, bytes) or len(data) > MAX_BUFFER_BYTES or
            not isinstance(source, bytes) or not isinstance(rows, list) or len(rows) > 4096):
        raise ValueError('Bounded material uniform inputs required')
    for row in rows:
        if (set(row) != {'hash', 'offset', 'size'} or
                any(type(row[key]) is not int or not 0 <= row[key] <= 0xffffffff
                    for key in row) or row['offset'] + row['size'] > len(data)):
            raise ValueError('Material parameter layout escaped its owned buffer')
    key = xxh32_intdigest(name.encode(), seed=0)
    row = next((row for row in rows if row['hash'] == key), None)
    if row is None:
        return data, False, 0
    length = min(count * 16, row['size'])
    if len(source) < length:
        raise ValueError('Material update source is shorter than its clamped copy')
    begin = row['offset']
    if data[begin:begin + length] == source[:length]:
        return data, False, length
    result = bytearray(data)
    result[begin:begin + length] = source[:length]
    return bytes(result), True, length


def material_uniform_layouts(backend, binding, program, name, count):
    validate_parameter(name, count)
    if (not isinstance(binding, dict) or not any(binding is row for row in backend.records) or
            binding['glProgram'] != program['glHandle']):
        raise ValueError('Owned GLES material binding required')
    key = xxh32_intdigest(name.encode(), seed=0)
    # These destinations have not been supplied to this port. Do not quietly
    # treat a matching update as a zero-byte upload.
    for block in [*binding['requiredSceneBlocks'], *binding['requiredSceneDataBuffers']]:
        members = block.get('members', block.get('requiredMembers', []))
        if any(xxh32_intdigest(member['name'].encode(), seed=0) == key for member in members):
            raise ValueError('Matching scene-buffer material update is not implemented')
    layouts = []
    required = 0
    for buffer in binding['uniformBuffers']:
        if not any(handle.value == buffer['glHandle'] for handle in backend.buffers):
            raise ValueError('Material update buffer is not owned by its GLES backend')
        translation = backend.shaders.shaders[program[buffer['stage']]]['translation']
        blocks = [block for block in translation['sidecar']['blocks']
                  if block['name'] == '$Globals' and block['glslName'] == buffer['name']]
        if len(blocks) != 1:
            raise ValueError('Owned material uniform reflection differs')
        block = blocks[0]
        data = bytes.fromhex(buffer['bytesHex'])
        if block['size'] != len(data):
            raise ValueError('Owned material buffer size differs from reflection')
        rows = [{'hash': xxh32_intdigest(member['name'].encode(), seed=0),
                 'offset': member['offset'], 'size': member['size']}
                for member in block['members'] if member['used']]
        match = next((row for row in rows if row['hash'] == key), None)
        if match is not None:
            required = max(required, min(count * 16, match['size']))
        # Validate the complete layout before any GPU mutation.
        material_uniform_copy(data, rows, name, 0, b'')
        layouts.append((buffer, rows))
    return layouts, required


def update_material_uniforms(backend, binding, program, name, count, source):
    layouts, required = material_uniform_layouts(backend, binding, program, name, count)
    if len(source) < required:
        raise ValueError('Owned GLES material update source is incomplete')
    gl = backend.gl
    backend.device.fn(gl, 'glBufferSubData', None, C.c_uint, C.c_ssize_t, C.c_ssize_t, C.c_void_p)
    if gl.glGetError():
        raise ValueError('GLES error before material uniform update')
    previous = C.c_int()
    gl.glGetIntegerv(0x8a28, C.byref(previous))
    records = []
    try:
        for buffer, rows in layouts:
            before = bytes.fromhex(buffer['bytesHex'])
            after, changed, copied = material_uniform_copy(before, rows, name, count, source)
            gl.glBindBuffer(0x8a11, buffer['glHandle'])
            pointer = gl.glMapBufferRange(0x8a11, 0, len(before), 1)
            if not pointer:
                raise ValueError('Material uniform pre-update GPU readback is unavailable')
            actual = C.string_at(pointer, len(before))
            if not gl.glUnmapBuffer(0x8a11) or actual != before:
                raise ValueError('Material GPU buffer diverged from its owned bytes')
            if changed:
                raw = C.create_string_buffer(after)
                gl.glBufferSubData(0x8a11, 0, len(after), raw)
                pointer = gl.glMapBufferRange(0x8a11, 0, len(after), 1)
                if not pointer:
                    raise ValueError('Material uniform post-update GPU readback is unavailable')
                actual = C.string_at(pointer, len(after))
                if not gl.glUnmapBuffer(0x8a11) or actual != after:
                    raise ValueError('Material uniform GPU update bytes differ')
                buffer['bytesHex'] = after.hex()
                buffer['gpuReadbackSha256'] = hashlib.sha256(actual).hexdigest()
            records.append({'stage': buffer['stage'], 'name': buffer['name'], 'changed': changed,
                            'copiedBytes': copied, 'gpuReadbackSha256': hashlib.sha256(actual).hexdigest()})
        if gl.glGetError():
            raise ValueError('GLES material uniform update failed')
    finally:
        gl.glBindBuffer(0x8a11, previous.value)
    return {'parameterName': name, 'vectorCount': count, 'buffers': records,
            'changed': any(row['changed'] for row in records), 'gpuBytesVerified': True}


class NativeMaterialUniformUpdates:
    def initialize_material_uniform_updates(self):
        if (getattr(self, 'material_uniform_updates', None) is not None or
                self.q(DEVICE) != PIPELINE_DEVICE_VTABLE or
                self.q(PIPELINE_DEVICE_VTABLE + 0xa0) != 0xa5a5a5a5a5a5a5a5):
            raise ValueError('Cold owned GLES material-update interface required')
        self.material_uniform_updates = []
        self.u.mem_write(UPDATE_CALLBACK, b'\xc3')
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.material_uniform_update,
                        begin=UPDATE_CALLBACK, end=UPDATE_CALLBACK)
        self.put(PIPELINE_DEVICE_VTABLE + 0xa0, 'Q', UPDATE_CALLBACK)
        return {'deviceSlot': 0xa0, 'observedReturnRva': 0x17ba481,
                'actualGlesBufferUpdates': True, 'nativeMetalDerivedObjects': False}

    def material_uniform_update(self, uc, address, size, user):
        pointer = uc.reg_read(r.UC_X86_REG_RSI)
        payload = uc.reg_read(r.UC_X86_REG_RDX)
        if (uc.reg_read(r.UC_X86_REG_RDI) != DEVICE or
                self.q(uc.reg_read(r.UC_X86_REG_RSP)) != self.base + 0x17ba481 or
                pointer not in self.native_bindings or self.pending_binding is not None or
                self.material_backend is None or not self.library_pointer(payload, 20)):
            raise ValueError('Unowned or unobserved material uniform update')
        request = [row for row in self.material_binding_requests if row.get('bindingPointer') == pointer]
        if len(request) != 1:
            raise ValueError('Material binding has no unique original creation request')
        pipeline = self.native_pipelines[request[0]['nativePipeline']]
        program = self.native_programs[pipeline['nativeProgram']]
        binding = self.native_bindings[pointer]
        name = self.cstring(self.q(payload)).decode('utf-8')
        count = self.u32(payload + 16)
        _, required = material_uniform_layouts(self.material_backend, binding, program, name, count)
        source = self.q(payload + 8)
        if required and not self.library_pointer(source, required):
            raise ValueError('Material update source escaped owned memory')
        data = bytes(self.u.mem_read(source, required)) if required else b''
        record = update_material_uniforms(self.material_backend, binding, program, name, count, data)
        record.update(nativeBinding=pointer, returnRva=0x17ba481)
        self.material_uniform_updates.append(record)
        self.ret()
