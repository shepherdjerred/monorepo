"""Original VFX reflection registration and serialized property loading.

Only an owned byte stream and bounded C/library services are modeled. The game
class registrations, constructors, property lookup, type dispatch, containers,
pointer construction and serialized values execute unchanged. This does not
post-load assets, acquire materials or create an effect runtime.
"""
import struct

import unicorn
from unicorn import x86_const as r
from animation_rig_native import NativeAnimationRig

OBJECT = 0x10020000
CALLBACK = 0x100c0000
WRAPPER = 0x100d0000
STREAM = 0x100d0100
VTABLE = 0x100d0200
CONTEXT = 0x100d0300
CACHE = 0x100d0400
CANARY = 0x100b0000
REGISTRY = 0x247b7c0
ROOT_TYPE = 0x09cde442


class UnsupportedAssetClass(ValueError):
    pass


class NativeVfxAssets(NativeAnimationRig):
    def __init__(self, package, client):
        super().__init__(package, client)
        self.mutexes, self.library_calls = {}, []
        self.input, self.cursor, self.stream_calls = b"", 0, []
        self.loading, self.dirty_pages = False, {}
        self.ignored, self.mismatched = [], []
        # Matching string deallocation wrapper for the already-modeled
        # 0x14766c0 allocation boundary; its full engine allocator is absent.
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.string_free,begin=self.base+0x1478f10,end=self.base+0x1478f10)
        self.put(self.base+0x22e0310,"Q",CANARY)
        self.put(CANARY,"Q",0x7766554433221100)
        self.call(0x17ac9a0,{})
        count = self.u32(self.base+REGISTRY+8)
        if not 0 < count <= 1024:
            raise ValueError("Invalid original VFX type registry")
        array = self.q(self.base+REGISTRY)
        self.types = {}
        for i in range(count):
            address = self.q(array+i*8)
            identity = self.u32(address+8)
            if identity in self.types or not self.base <= address < self.base+len(self.image)-0x88:
                raise ValueError("Ambiguous original VFX type descriptor")
            self.types[identity] = address
        if ROOT_TYPE not in self.types or self.u32(self.types[ROOT_TYPE]+0x60)!=135:
            raise ValueError("Unsupported original emitter schema")
        self.type_catalog = self.catalog()
        self.call(0x14aa3bf,{},0x14aa516)
        self.baseline_heap, self.baseline_allocations = self.next_heap, dict(self.allocations)
        for i, offset in enumerate([0x10,0x28,0x30]):
            address = CALLBACK+i*16
            self.u.mem_write(address,b"\xc3")
            self.put(VTABLE+offset,"Q",address)
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.stream_service,begin=address,end=address)
        for at, callback in [(0x14bc954,self.unknown_property),(0x14b5816,self.mismatched_property),
                             (0x14bd284,self.unknown_class)]:
            self.u.hook_add(unicorn.UC_HOOK_CODE,callback,begin=self.base+at,end=self.base+at)
        self.u.hook_add(unicorn.UC_HOOK_MEM_WRITE,self.image_write,begin=self.base,end=self.base+len(self.image)-1)
        # Let the original pointer reader sort/finalize its complete registry
        # once, using a controlled empty instance of the registered point shape.
        self.baseline_mutexes = dict(self.mutexes)
        self.load([struct.pack("<IBIIH",0x3bf0b4ed,0x82,0xee39916f,2,0)])
        self.baseline_heap,self.baseline_allocations = self.next_heap,dict(self.allocations)
        self.baseline_mutexes = dict(self.mutexes)
        self.dirty_pages = {}

    def u32(self,at):
        return struct.unpack("<I",self.u.mem_read(at,4))[0]

    def string_free(self,uc,address,size,user):
        at=self.u.reg_read(r.UC_X86_REG_RDI)
        if at and at not in self.allocations:raise ValueError("Unowned native asset string deallocation")
        self.library_calls.append({"name":"owned-string-free-wrapper","result":0})
        self.ret()

    def check_block(self,uc,address,size,user):
        if address-self.base!=0x1478f10:super().check_block(uc,address,size,user)

    def library_pointer(self, at, size):
        return (0x10000000 <= at <= 0x12000000-size or self.base <= at <= self.base+len(self.image)-size)

    def service(self,uc,address,size,user):
        if self.loading and address-self.base==0x1fee62a:
            at=self.u.reg_read(r.UC_X86_REG_RDI)
            if self.base<=at<self.base+len(self.image):self.image_write(uc,None,at,1,0,None)
        super().service(uc,address,size,user)

    def cstring(self, at):
        result = bytearray()
        for i in range(4096):
            if not self.library_pointer(at+i,1):
                raise ValueError("Unowned native asset string")
            value = self.u.mem_read(at+i,1)[0]
            if not value:
                return bytes(result)
            result.append(value)
        raise ValueError("Native asset string exceeds boundary")

    def reject(self,uc,address,size,user):
        if address-self.base not in [0x1fee5f4,0x1fee5fa]:
            super().reject(uc,address,size,user)

    def imported(self,uc,address,size,user):
        name = self.source.imports[address-self.base]
        if name == "_strlen":
            result = len(self.cstring(self.u.reg_read(r.UC_X86_REG_RDI)))
        elif name == "_strcmp":
            a,b = [self.cstring(self.u.reg_read(reg)) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI]]
            result = next((x-y for x,y in zip(a+b"\0",b+b"\0") if x!=y),0)
        elif name == "___bzero":
            at,count = self.u.reg_read(r.UC_X86_REG_RDI),self.u.reg_read(r.UC_X86_REG_RSI)
            if not 0<=count<=0x100000 or not 0x10000000<=at<=0x12000000-count:
                raise ValueError("Unowned native asset zero fill")
            if count:self.u.mem_write(at,bytes(count))
            result = 0
        elif name == "____chkstk_darwin":
            count,sp = self.u.reg_read(r.UC_X86_REG_RAX),self.u.reg_read(r.UC_X86_REG_RSP)
            if self.q(sp)-self.base!=0x1499b00 or count!=0x1028 or not 0x10008000<=sp-count<=sp<=0x10010008:
                raise ValueError("Unadmitted asset stack-probe call site")
            for at in range(sp-count,sp+1,4096):self.u.mem_read(at,1)
            result = count
        elif name == "_pthread_mutex_init":
            at,attrs = self.u.reg_read(r.UC_X86_REG_RDI),self.u.reg_read(r.UC_X86_REG_RSI)
            if attrs or at in self.mutexes or not self.library_pointer(at,64):
                raise ValueError("Unadmitted single-thread asset mutex")
            self.mutexes[at] = False
            result = 0
        elif name in ["_pthread_mutex_lock","_pthread_mutex_unlock"]:
            at = self.u.reg_read(r.UC_X86_REG_RDI)
            if at not in self.mutexes or self.mutexes[at] != (name=="_pthread_mutex_unlock"):
                raise ValueError("Invalid asset mutex ownership")
            self.mutexes[at] = not self.mutexes[at]
            result = 0
        else:
            return super().imported(uc,address,size,user)
        self.library_calls.append({"name":name,"result":result})
        self.u.reg_write(r.UC_X86_REG_RAX,result & 0xffffffffffffffff)
        self.ret()

    def catalog(self):
        result = {}
        for identity,address in sorted(self.types.items()):
            count = self.u32(address+0x60)
            if count>1024:raise ValueError("Native asset property count exceeds boundary")
            fields = self.q(address+0x58)
            properties = []
            for i in range(count):
                raw = bytes(self.u.mem_read(fields+i*0x30,0x30))
                target,key,offset = struct.unpack_from("<QII",raw)
                properties.append({"hash":key,"offset":offset,"type":raw[0x11],"mask":raw[0x10],
                    "referencedTypeRva":target-self.base if target else None,"recordHex":raw.hex()})
            result[f"{identity:08x}"] = {"rva":address-self.base,"size":self.q(address+0x40),
                "alignment":self.q(address+0x48),"baseTypeRva":self.q(address+0x38)-self.base if self.q(address+0x38) else None,
                "newRva":self.q(address+0x10)-self.base if self.q(address+0x10) else None,
                "constructRva":self.q(address+0x20)-self.base if self.q(address+0x20) else None,
                "properties":properties}
        return result

    def image_write(self,uc,kind,address,size,value,user):
        if not self.loading:return
        if address < self.base+0x1fef000:
            raise ValueError("Asset loading attempted to mutate executable code")
        for page in range(address & ~4095,((address+size-1)&~4095)+1,4096):
            if page not in self.dirty_pages:
                self.dirty_pages[page] = bytes(self.u.mem_read(page,min(4096,self.base+len(self.image)-page)))

    def unknown_property(self,uc,address,size,user):
        self.ignored.append({"hash":self.u.reg_read(r.UC_X86_REG_R14D),"type":self.u.reg_read(r.UC_X86_REG_AL),"cursor":self.cursor})

    def mismatched_property(self,uc,address,size,user):
        prop = self.u.reg_read(r.UC_X86_REG_RCX)
        self.mismatched.append({"hash":self.u32(prop+8),"expected":self.u.mem_read(prop+0x11,1)[0],
                               "actual":self.u.reg_read(r.UC_X86_REG_DL),"cursor":self.cursor})

    def unknown_class(self,uc,address,size,user):
        raise UnsupportedAssetClass(f"Native VFX registry does not contain class {self.u.reg_read(r.UC_X86_REG_R15D):08x}")

    def stream_service(self,uc,address,size,user):
        if self.u.reg_read(r.UC_X86_REG_RDI)!=STREAM:raise ValueError("Unowned native asset stream instance")
        which = (address-CALLBACK)//16
        if which==0:
            dest,count = self.u.reg_read(r.UC_X86_REG_RSI),self.u.reg_read(r.UC_X86_REG_RDX)
            if count>len(self.input)-self.cursor or not 0x10000000<=dest<=0x12000000-count:
                raise ValueError("Native asset stream read exceeds owned bounds")
            if count:self.u.mem_write(dest,self.input[self.cursor:self.cursor+count])
            self.stream_calls.append({"operation":"read","offset":self.cursor,"bytes":count})
            self.cursor += count;result = count
        elif which==1:
            result = self.cursor
        else:
            result = self.u.reg_read(r.UC_X86_REG_RSI)
            if result>len(self.input):raise ValueError("Native asset seek exceeds input")
            self.stream_calls.append({"operation":"seek","offset":result})
            self.cursor = result;result = 1
        self.u.reg_write(r.UC_X86_REG_RAX,result);self.ret()

    def load(self, fields):
        for page,raw in self.dirty_pages.items():self.u.mem_write(page,raw)
        self.dirty_pages = {}
        self.next_heap,self.allocations = self.baseline_heap,dict(self.baseline_allocations)
        self.mutexes = dict(self.baseline_mutexes)
        self.u.mem_write(OBJECT,bytes([0xa5])*0x470)
        self.u.mem_write(WRAPPER,bytes(0x500))
        self.put(WRAPPER,"Q",STREAM);self.put(STREAM,"Q",VTABLE)
        for i,offset in enumerate([0x10,0x28,0x30]):self.put(VTABLE+offset,"Q",CALLBACK+i*16)
        self.ignored,self.mismatched,self.stream_calls = [],[],[]
        self.loading = True
        try:
            self.call(self.q(self.types[ROOT_TYPE]+0x20)-self.base,{r.UC_X86_REG_RDI:OBJECT})
            for raw in fields:
                self.input,self.cursor = raw,0
                self.put(CACHE,"Q",0)
                try:
                    self.call(0x14bc830,{r.UC_X86_REG_RDI:CONTEXT,r.UC_X86_REG_RSI:OBJECT,
                        r.UC_X86_REG_RDX:self.types[ROOT_TYPE],r.UC_X86_REG_RCX:WRAPPER,r.UC_X86_REG_R8:CACHE})
                except UnsupportedAssetClass:
                    raise
                except Exception as error:
                    raise ValueError(f"Native asset field {raw[:5].hex()}, cursor {self.cursor}/{len(raw)}, RIP {self.u.reg_read(r.UC_X86_REG_RIP)-self.base:x}: {error}") from error
                if self.cursor!=len(raw):raise ValueError("Native asset reader did not consume complete field")
        finally:
            self.loading = False
        return {"objectHex":bytes(self.u.mem_read(OBJECT,0x470)).hex(),
            "heapHex":bytes(self.u.mem_read(self.baseline_heap,self.next_heap-self.baseline_heap)).hex(),
            "heapStart":self.baseline_heap,"ignored":list(self.ignored),"mismatched":list(self.mismatched),
            "streamCalls":len(self.stream_calls)}
