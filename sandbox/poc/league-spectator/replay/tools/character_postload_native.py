"""Character post-load with a bounded SysV libc formatting bridge.

Only the observed narrow string/int printf conversions are admitted. The game
callbacks and their use of the formatted names execute unchanged.
"""
import ctypes
import re
import unicorn
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from vfx_spawn_native import ADDRESSES


class NativeCharacterPostload(NativeCharacterAssets):
    def __init__(self,*args):
        self.character_format_calls = []
        self.character_resource_boundary = None
        super().__init__(*args)
        self.character_sprintf = ctypes.CDLL('msvcrt.dll').sprintf
        self.character_sprintf.restype = ctypes.c_int
        self.character_sprintf.argtypes = [ctypes.c_void_p,ctypes.c_char_p]
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.require_default_texture,
                        begin=self.base+0x17e34c8,end=self.base+0x17e34c8)

    def require_default_texture(self,uc,address,size,user):
        if uc.reg_read(r.UC_X86_REG_RDI) == 0:
            key = uc.reg_read(r.UC_X86_REG_R15)
            self.character_resource_boundary = {'kind':'original-default-texture-required',
                                                'managerFieldOffset':0xd8,'request':key,
                                                'fileHash':self.q(key) if self.library_pointer(key,8) else None}
            raise ValueError('Original default texture at manager +0xd8 requires completed graphics initialization')

    def initialize_texture_manager_prefix(self):
        if self.q(self.base+0x246fdf0):
            raise ValueError('Character texture-manager control is already initialized')
        manager = self.allocate(0x108)
        self.call(0x17e2301,{r.UC_X86_REG_RDI:manager,r.UC_X86_REG_RBP:ADDRESSES['stack']-8,
                             r.UC_X86_REG_RSP:ADDRESSES['stack']-0xa0},0x17e240c)
        if self.q(self.base+0x246fdf0) != manager:
            raise ValueError('Original character texture-manager prefix did not publish its instance')
        return {'object':manager,'bytesHex':bytes(self.u.mem_read(manager,0x108)).hex(),
                'originalPrefix':[0x17e2301,0x17e240c],'fullConstructorExecuted':False,
                'graphicsProviderInstalled':False,'defaultTexturesCreated':False}

    def initialize_resource_groups(self):
        if self.q(self.base+0x24712c8):
            raise ValueError('Character resource groups are already initialized')
        # Complete original group-manager construction and the original boot
        # assignment of group zero's priority, before unrelated startup code.
        self.call(0x665f24,{},0x665f51)
        manager = self.q(self.base+0x24712c8)
        if self.allocations.get(manager) != 0x20 or not self.q(manager+0x18):
            raise ValueError('Original character resource-group manager differs')
        return {'object':manager,'bytesHex':bytes(self.u.mem_read(manager,0x20)).hex(),
                'originalBootPrefix':[0x665f24,0x665f51],'fullConstructorExecuted':True,
                'currentGroup':self.q(manager+0x18)}

    def imported(self,uc,address,size,user):
        name = self.source.imports[address-self.base]
        if name != '_vsnprintf':
            return super().imported(uc,address,size,user)
        destination,capacity,format_at,args_at = [uc.reg_read(register) for register in
            [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX,r.UC_X86_REG_RCX]]
        if capacity > 0x100000 or capacity and not self.library_pointer(destination,capacity) or not self.library_pointer(args_at,24):
            raise ValueError('Character formatter exceeds owned destination/argument bounds')
        format_ = self.cstring(format_at)
        # SysV x86-64 va_list: gp_offset, fp_offset, overflow_arg_area,
        # reg_save_area. Do not pass a Darwin va_list to the Windows CRT.
        # https://gitlab.com/x86-psABIs/x86-64-ABI/-/blob/master/x86-64-ABI/low-level-sys-info.tex
        gp,fp = self.u32(args_at),self.u32(args_at+4)
        overflow,saved = self.q(args_at+8),self.q(args_at+16)
        if gp > 48 or gp % 8 or not 48 <= fp <= 304 or fp % 16:
            raise ValueError('Unadmitted SysV formatter argument layout')
        arguments,observed = [],[]
        output_bound = len(format_)+1
        cursor = 0
        while cursor < len(format_):
            if format_[cursor] != ord('%'):
                cursor += 1
                continue
            if format_[cursor:cursor+2] == b'%%':
                cursor += 2
                continue
            match = re.match(rb'%[sdiu]',format_[cursor:])
            if match is None or len(arguments) >= 32:
                raise ValueError('Unadmitted character printf conversion: '+repr(format_))
            if gp < 48:
                at = saved+gp
                gp += 8
            else:
                at = overflow
                overflow += 8
            if not self.library_pointer(at,8):
                raise ValueError('Character formatter argument escaped owned memory')
            value = self.q(at)
            conversion = match.group()[-1:]
            if conversion == b's':
                encoded = self.cstring(value)
                arguments.append(ctypes.c_char_p(encoded))
                observed.append({'conversion':'s','bytesHex':encoded.hex()})
                output_bound += len(encoded)
            elif conversion == b'u':
                arguments.append(ctypes.c_uint32(value&0xffffffff))
                observed.append({'conversion':'u','value':value&0xffffffff})
                output_bound += 10
            else:
                signed = ctypes.c_int32(value&0xffffffff).value
                arguments.append(ctypes.c_int32(signed))
                observed.append({'conversion':conversion.decode('ascii'),'value':signed})
                output_bound += 11
            cursor += len(match.group())
        if output_bound > 0x100000:
            raise ValueError('Character formatter output exceeds explicit bound')
        # The admitted conversions have a proved finite output bound. Use the
        # host C formatter for their bytes, then apply snprintf's truncation and
        # would-have-written return contract explicitly.
        output = ctypes.create_string_buffer(output_bound)
        count = self.character_sprintf(output,format_,*arguments)
        if not 0 <= count < output_bound:
            raise ValueError('Character formatter returned an unadmitted length')
        stored = output.raw[:min(max(0,capacity-1),count)]+b'\0' if capacity else b''
        if capacity:
            uc.mem_write(destination,stored)
        self.put(args_at,'IIQQ',gp,fp,overflow,saved)
        self.character_format_calls.append({'formatHex':format_.hex(),'arguments':observed,'capacity':capacity,
                                           'count':count,'outputHex':stored.hex()})
        uc.reg_write(r.UC_X86_REG_RAX,count)
        self.ret()
