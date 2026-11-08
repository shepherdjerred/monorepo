"""Original legacy effect readers with bounded ASCII C-locale services."""
from unicorn import x86_const as r
import ctypes as C
import math
import re
import struct
from effect_preload_native import NativeEffectPreload


class NativeLegacyEffectInputs(NativeEffectPreload):
    def __init__(self,*args):
        self.legacy_platform_calls = []
        self.legacy_thread_exit_callbacks = []
        super().__init__(*args)
        self.legacy_crt = C.CDLL('ucrtbase.dll')
        self.legacy_format = getattr(self.legacy_crt,'__stdio_common_vsprintf')
        self.legacy_format.argtypes = [C.c_uint64,C.c_void_p,C.c_size_t,C.c_char_p,C.c_void_p,C.c_void_p]
        self.legacy_format.restype = C.c_int
        self.legacy_locale = self.legacy_crt._create_locale
        self.legacy_locale.argtypes = [C.c_int,C.c_char_p]
        self.legacy_locale.restype = C.c_void_p
        self.legacy_free_locale = self.legacy_crt._free_locale
        self.legacy_free_locale.argtypes = [C.c_void_p]
        self.legacy_scan = getattr(self.legacy_crt,'__stdio_common_vsscanf')
        self.legacy_scan.argtypes = [C.c_uint64,C.c_char_p,C.c_size_t,C.c_char_p,C.c_void_p,C.c_void_p]
        self.legacy_scan.restype = C.c_int

    def scan_legacy_floats(self,uc,format_):
        source,args_at = uc.reg_read(r.UC_X86_REG_RDI),uc.reg_read(r.UC_X86_REG_RDX)
        data = self.cstring(source)
        if len(data) > 4096 or any(byte > 127 for byte in data) or not self.library_pointer(args_at,24):
            raise ValueError('Legacy float scan escaped ASCII input/va_list bounds')
        gp,fp = self.u32(args_at),self.u32(args_at+4)
        overflow,saved = self.q(args_at+8),self.q(args_at+16)
        if gp > 48 or gp % 8 or not 48 <= fp <= 304 or fp % 16:
            raise ValueError('Legacy float scan received an invalid SysV va_list')
        count = format_.count(b'%f')
        destinations = []
        for _ in range(count):
            if gp < 48:
                at = saved+gp
                gp += 8
            else:
                at = overflow
                overflow += 8
            if not self.library_pointer(at,8):
                raise ValueError('Legacy float scan argument escaped owned memory')
            destination = self.q(at)
            if not self.writable_file_memory(destination,4):
                raise ValueError('Legacy float scan destination escaped owned writable memory')
            destinations.append(destination)
        values = (C.c_float*count)()
        arguments = (C.c_void_p*count)(*[C.addressof(values)+i*4 for i in range(count)])
        locale = self.legacy_locale(0,b'C')
        if not locale:raise ValueError('C-locale scanning initialization failed')
        try:
            result = self.legacy_scan(0,data,len(data),format_,locale,arguments)
        finally:
            self.legacy_free_locale(locale)
        if not -1 <= result <= count or any(not math.isfinite(values[i]) for i in range(max(0,result))):
            raise ValueError('Legacy float scan returned an unadmitted count/value')
        for i in range(max(0,result)):
            uc.mem_write(destinations[i],struct.pack('<f',values[i]))
        self.put(args_at,'IIQQ',gp,fp,overflow,saved)
        self.legacy_platform_calls.append({'name':'_vsscanf','format':format_.decode('ascii'),
                                           'inputHex':data.hex(),'assigned':result,
                                           'values':[values[i] for i in range(max(0,result))]})
        uc.reg_write(r.UC_X86_REG_RAX,result&0xffffffffffffffff)
        self.ret()

    def format_legacy_float(self,uc,format_):
        destination,capacity,args_at = [uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RCX]]
        if (capacity > 0x100000 or capacity and not self.writable_file_memory(destination,capacity) or
                not self.library_pointer(args_at,24)):
            raise ValueError('Legacy float formatting escaped destination/argument bounds')
        gp,fp = self.u32(args_at),self.u32(args_at+4)
        overflow,saved = self.q(args_at+8),self.q(args_at+16)
        if gp > 48 or gp % 8 or not 48 <= fp <= 304 or fp % 16:
            raise ValueError('Legacy float formatting received an invalid SysV va_list')
        values = []
        for _ in range(format_.count(b'%g')):
            if fp < 176:
                at = saved+fp
                fp += 16
            else:
                at = overflow
                overflow += 8
            if not self.library_pointer(at,8):
                raise ValueError('Legacy float argument escaped owned memory')
            value = struct.unpack('<d',bytes(uc.mem_read(at,8)))[0]
            if not math.isfinite(value):
                raise ValueError('Legacy float formatter only admits finite doubles')
            values.append(value)
        # Translate the admitted SysV doubles into a Windows x64 va_list.
        # C-locale UCRT formatting supplies C99 exponent spelling; the legacy
        # MSVCRT formatter uses a different exponent width. No host locale is
        # changed, and snprintf truncation is applied explicitly below.
        locale = self.legacy_locale(0,b'C')
        if not locale:raise ValueError('C-locale formatting initialization failed')
        output,arguments = C.create_string_buffer(256),(C.c_double*len(values))(*values)
        try:
            count = self.legacy_format(0,output,256,format_,locale,arguments)
        finally:
            self.legacy_free_locale(locale)
        if not 0 <= count < 256:
            raise ValueError('Legacy %g output exceeded its admitted finite bound')
        stored = output.raw[:min(max(0,capacity-1),count)]+b'\0' if capacity else b''
        if capacity:uc.mem_write(destination,stored)
        self.put(args_at,'IIQQ',gp,fp,overflow,saved)
        self.character_format_calls.append({'formatHex':format_.hex(),'arguments':[{'conversion':'g','value':v} for v in values],
                                           'capacity':capacity,'count':count,'outputHex':stored.hex()})
        uc.reg_write(r.UC_X86_REG_RAX,count)
        self.ret()

    def imported(self,uc,address,size,user):
        name = self.source.imports[address-self.base]
        if name == '_vsnprintf' and self.cstring(uc.reg_read(r.UC_X86_REG_RDX)) == b'%lli':
            destination,capacity,args_at = [uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RCX]]
            if (capacity > 0x100000 or capacity and not self.writable_file_memory(destination,capacity) or
                    not self.library_pointer(args_at,24)):
                raise ValueError('Legacy integer formatting escaped destination/argument bounds')
            gp,fp = self.u32(args_at),self.u32(args_at+4)
            overflow,saved = self.q(args_at+8),self.q(args_at+16)
            if gp > 48 or gp % 8 or not 48 <= fp <= 304 or fp % 16:
                raise ValueError('Legacy integer formatting received an invalid SysV va_list')
            if gp < 48:
                at = saved+gp
                gp += 8
            else:
                at = overflow
                overflow += 8
            if not self.library_pointer(at,8):
                raise ValueError('Legacy 64-bit integer argument escaped owned memory')
            value = C.c_int64(self.q(at)).value
            encoded = str(value).encode('ascii')
            stored = encoded[:max(0,capacity-1)]+b'\0' if capacity else b''
            if capacity:uc.mem_write(destination,stored)
            self.put(args_at,'IIQQ',gp,fp,overflow,saved)
            self.character_format_calls.append({'formatHex':b'%lli'.hex(),'arguments':[{'conversion':'lli','value':value}],
                                               'capacity':capacity,'count':len(encoded),'outputHex':stored.hex()})
            uc.reg_write(r.UC_X86_REG_RAX,len(encoded))
            self.ret()
            return
        if name == '__tlv_atexit':
            callback,receiver,dso = [uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX]]
            if (not self.base <= callback < self.base+0x1fef000 or not self.library_pointer(receiver,1) or
                    dso != self.base or len(self.legacy_thread_exit_callbacks) >= 256):
                raise ValueError('Legacy thread-exit registration escaped original callback/receiver bounds')
            self.legacy_thread_exit_callbacks.append({'callbackRva':callback-self.base,'receiver':receiver,'dso':dso})
            # Registration succeeds in this single live emulated thread. Its
            # original destructors are retained, not run before thread exit.
            # This probe does not claim complete process/thread shutdown.
            uc.reg_write(r.UC_X86_REG_RAX,0)
            self.ret()
            return
        if name == '_strtok_r':
            first,delimiter,save = [uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX]]
            if not self.writable_file_memory(save,8):
                raise ValueError('Legacy reentrant tokenizer context escaped owned writable memory')
            cursor = first or self.q(save)
            if not cursor:raise ValueError('Legacy reentrant tokenizer has no initialized input')
            text,delimiters = self.cstring(cursor),set(self.cstring(delimiter))
            start = 0
            while start < len(text) and text[start] in delimiters:start += 1
            end = start
            while end < len(text) and text[end] not in delimiters:end += 1
            result = cursor+start if start < len(text) else 0
            if result and end < len(text):
                if not self.writable_file_memory(cursor+end,1):
                    raise ValueError('Legacy tokenizer delimiter escaped writable input')
                uc.mem_write(cursor+end,b'\0')
                following = cursor+end+1
            else:
                following = cursor+len(text)
            self.put(save,'Q',following)
            self.legacy_platform_calls.append({'name':name,'inputBytes':len(text),
                                               'tokenBytes':end-start,'returnedToken':bool(result)})
            uc.reg_write(r.UC_X86_REG_RAX,result)
            self.ret()
            return
        if name == '_sscanf':
            source,format_at,first,second = [uc.reg_read(reg) for reg in
                [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX,r.UC_X86_REG_RCX]]
            data,format_ = self.cstring(source),self.cstring(format_at)
            if (format_ != b'%i %i' or len(data) > 4096 or any(byte > 127 for byte in data) or
                    any(not self.writable_file_memory(at,4) for at in [first,second])):
                raise ValueError('Unadmitted legacy direct integer scan format/input/destination')
            values = (C.c_int32*2)()
            arguments = (C.c_void_p*2)(C.addressof(values),C.addressof(values)+4)
            locale = self.legacy_locale(0,b'C')
            if not locale:raise ValueError('C-locale integer scanning initialization failed')
            try:
                result = self.legacy_scan(0,data,len(data),format_,locale,arguments)
            finally:
                self.legacy_free_locale(locale)
            if not -1 <= result <= 2:
                raise ValueError('Legacy integer scan returned an invalid assignment count')
            for i,at in enumerate([first,second][:max(0,result)]):
                uc.mem_write(at,struct.pack('<i',values[i]))
            self.legacy_platform_calls.append({'name':name,'format':'%i %i','inputHex':data.hex(),
                                               'assigned':result,'values':list(values)[:max(0,result)]})
            uc.reg_write(r.UC_X86_REG_RAX,result&0xffffffffffffffff)
            self.ret()
            return
        if name == '_vsnprintf':
            format_ = self.cstring(uc.reg_read(r.UC_X86_REG_RDX))
            if re.fullmatch(rb'%g(?: %g){0,3}',format_):
                return self.format_legacy_float(uc,format_)
        if name == '_vsscanf':
            format_ = self.cstring(uc.reg_read(r.UC_X86_REG_RSI))
            if not re.fullmatch(rb'%f(?:[ ,]+%f){0,4}',format_):
                raise ValueError('Unadmitted legacy scan format: '+repr(format_))
            return self.scan_legacy_floats(uc,format_)
        if name != '_strncasecmp':
            return super().imported(uc,address,size,user)
        first,second,count = [uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX]]
        if count > 4096:
            raise ValueError('Legacy ASCII comparison exceeds explicit length bound')
        compared,result = 0,0
        for i in range(count):
            if not self.library_pointer(first+i,1) or not self.library_pointer(second+i,1):
                raise ValueError('Legacy ASCII comparison escaped owned inputs')
            a,b = uc.mem_read(first+i,1)[0],uc.mem_read(second+i,1)[0]
            if a > 127 or b > 127:
                raise ValueError('Legacy case comparison requires admitted ASCII inputs')
            lower_a = a+32 if 65 <= a <= 90 else a
            lower_b = b+32 if 65 <= b <= 90 else b
            compared += 1
            result = lower_a-lower_b
            if result or not a or not b:break
        self.legacy_platform_calls.append({'name':name,'limit':count,'comparedBytes':compared,'result':result})
        uc.reg_write(r.UC_X86_REG_RAX,result&0xffffffffffffffff)
        self.ret()
