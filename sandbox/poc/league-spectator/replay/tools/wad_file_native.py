"""Original WAD manager with a bounded, read-only C stdio bridge.

Archive registration, index validation and lookups execute original code.
Only explicitly allowed installed archives may be opened by the host bridge.
"""
from pathlib import Path
import hashlib
import json
import re
import unicorn
from unicorn import x86_const as r
from ai_client_native import NativeAIClientInputs
from vfx_spawn_native import ADDRESSES
from native_callback_code import NativeCallbackCode


class NativeWadFiles(NativeCallbackCode, NativeAIClientInputs):
    def __init__(self,*args):
        self.allowed_files,self.file_handles,self.file_calls = {},{},[]
        self.file_mappings = []
        self.file_errno = None
        self.file_once = {}
        self.file_keys,self.file_rwlocks = {},{}
        self.file_environment_queries = []
        self.file_exit_callbacks = []
        self.file_image_path = str(Path(args[1]).resolve()).replace('\\','/')
        self.file_image_references = 0
        # Apple Libc's C-locale table, retained with its source license in the
        # research cache. Do not substitute the Windows errno numbering.
        error_source = Path(args[0]).resolve().parents[1]/'research/darwin-errlst.c'
        error_bytes = error_source.read_bytes()
        if hashlib.sha256(error_bytes).hexdigest() != '7c3384292e8aac251c4528edf46a007beea194d3fb8431e1558ebd5fcc07a646':
            raise ValueError('Pinned Darwin errno source changed')
        table = error_bytes.decode().split('sys_errlist[] = {',1)[1].split('};',1)[0]
        self.file_errors = [json.loads(value) for value in re.findall(r'"(?:[^"\\]|\\.)*"',table)]
        if len(self.file_errors) != 108:
            raise ValueError('Darwin errno table length differs')
        self.file_error_pointers = {}
        self.file_unknown_error = None
        self.archive_slices = []
        self.archive_digests = []
        self.file_lookups,self.file_lookup_frames = [],{}
        super().__init__(*args)
        pool = next(value for value in self.profile['modeledServices'] if value['rva'] == 0x1499f00)
        if pool['service'] != 'bounded pool allocation in RSI':
            raise ValueError('Original prepared archive allocator contract changed')
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.allocate_pool,begin=self.base+0x1499f00,end=self.base+0x1499f00)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_archive_digest,begin=self.base+0x147baa4,end=self.base+0x147baa4)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_file_lookup,begin=self.base+0x147c480,end=self.base+0x147c480)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.finish_file_lookup,begin=self.base+0x147c526,end=self.base+0x147c526)

    def observe_file_lookup(self,uc,address,size,user):
        string = uc.reg_read(r.UC_X86_REG_RSI)
        pointer,count = self.q(string),self.u32(string+8)
        if count > 4096 or not self.library_pointer(pointer,count):
            raise ValueError('Original archive lookup path escaped owned string bounds')
        record = {'path':bytes(uc.mem_read(pointer,count)).decode('utf-8'),'exists':None}
        self.file_lookups.append(record)
        self.file_lookup_frames[uc.reg_read(r.UC_X86_REG_RSP)] = record

    def finish_file_lookup(self,uc,address,size,user):
        record = self.file_lookup_frames.pop(uc.reg_read(r.UC_X86_REG_RBP)+8,None)
        result = uc.reg_read(r.UC_X86_REG_RAX)&255
        if record is None or result not in [0,1]:
            raise ValueError('Original archive lookup return escaped its observed call')
        record['exists'] = bool(result)

    def observe_archive_digest(self,uc,address,size,user):
        frame = uc.reg_read(r.UC_X86_REG_RBP)
        count = self.u32(frame-0x54)
        if count != 32:
            raise ValueError('Original WAD index digest is not SHA-256 sized')
        self.archive_digests.append(bytes(uc.mem_read(frame-0x50,count)).hex())

    def call_archive_registration(self,manager,name):
        # Index hashing and RSA verification are substantial native work.
        # Resume the original call in finite slices without resetting its
        # stack, replacing hashing, or bypassing signature verification.
        self.u.context_restore(self.initial)
        self.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        self.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack'])
        self.u.reg_write(r.UC_X86_REG_RDI,manager)
        self.u.reg_write(r.UC_X86_REG_RSI,name)
        start = self.base+0x147bc90
        for index in range(64):
            self.u.emu_start(start,ADDRESSES['stop'],count=5000000)
            start = self.u.reg_read(r.UC_X86_REG_RIP)
            self.archive_slices.append({'slice':index+1,'instructionBound':5000000,'stop':start})
            if start == ADDRESSES['stop']:return
        raise ValueError('Original WAD registration exceeded 64 bounded instruction slices')

    def reject(self,uc,address,size,user):
        at = address-self.base
        if at != 0x1499f00 and self.source.imports.get(at) not in ['_malloc','_realloc','_free','_atexit']:
            super().reject(uc,address,size,user)

    def check_block(self,uc,address,size,user):
        if address-self.base != 0x1499f00:
            super().check_block(uc,address,size,user)

    def allocate_pool(self,uc,address,size,user):
        owner,count = uc.reg_read(r.UC_X86_REG_RDI),uc.reg_read(r.UC_X86_REG_RSI)
        if not self.base+0x1fef000 <= owner <= self.base+len(self.image)-8:
            raise ValueError('Native archive pool owner escaped original data image')
        uc.reg_write(r.UC_X86_REG_RAX,self.allocate(count,0xa5))
        self.ret()

    def library_pointer(self,address,size):
        if super().library_pointer(address,size):
            return True
        if not any(start <= address <= start+length-size for start,length in self.file_mappings):
            return False
        cursor = address
        for start,end,permissions in self.u.mem_regions():
            if start <= cursor <= end:
                if not permissions & unicorn.UC_PROT_READ:
                    return False
                cursor = min(address+size,end+1)
                if cursor == address+size:return True
        return False

    def writable_file_memory(self,address,size):
        if 0x10000000 <= address <= 0x12000000-size:
            return True
        if not self.library_pointer(address,size):return False
        cursor = address
        for start,end,permissions in self.u.mem_regions():
            if start <= cursor <= end:
                if not permissions & unicorn.UC_PROT_WRITE:return False
                cursor = min(address+size,end+1)
                if cursor == address+size:return True
        return False

    def allocate(self,size,fill=0):
        if size < 0x100000:
            return super().allocate(size,fill)
        # A WAD's 32-byte index exceeds the small object-probe allocation cap.
        # Keep a separate explicit bound within the same owned native arena.
        if not 0x100000 <= size <= 0x800000 or self.next_heap+size > 0x12000000:
            raise ValueError('Native archive allocation exceeds owned arena')
        address = self.next_heap
        self.next_heap = (address+size+15)&~15
        self.allocations[address] = size
        self.u.mem_write(address,bytes([fill])*size)
        self.heap_high_water = max(self.heap_high_water,self.next_heap)
        return address

    def allow_file(self,path):
        resolved = Path(path).resolve(strict=True)
        if not resolved.is_file():
            raise ValueError('Native archive input must be a regular file')
        self.allowed_files[str(resolved).replace('\\','/').lower()] = resolved

    def file_manager(self):
        if self.q(self.base+0x246d7b0):
            raise ValueError('Original archive manager is already initialized')
        self.call(0x620ae0,{})
        manager = self.q(self.base+0x246d7b0)
        if self.allocations.get(manager) != 0x70:
            raise ValueError('Original archive manager ownership differs')
        return manager

    def register_archive(self,manager,path):
        if str(Path(path).resolve()).replace('\\','/').lower() not in self.allowed_files:
            raise ValueError('Archive must be explicitly allowed before registration')
        name = self.allocate(16)
        self.call(0x14c2d60,{r.UC_X86_REG_RDI:name,r.UC_X86_REG_RSI:self.allocate_text(str(Path(path).resolve()).replace('\\','/'))})
        self.call_archive_registration(manager,name)
        count,table = self.u32(manager+0x50),self.q(manager+0x48)
        if not 0 < count <= 64 or not self.library_pointer(table,count*8):
            raise ValueError('Original archive registration produced an invalid table')
        archive = self.q(table+(count-1)*8)
        if not self.u.mem_read(archive+0x48,1)[0]:
            raise ValueError('Original archive index did not finish loading')
        return {'object':archive,'entries':self.u32(archive+0x58),'table':self.q(archive+0x50)}

    def file_exists(self,manager,path):
        name = self.allocate(16)
        self.call(0x14c2d60,{r.UC_X86_REG_RDI:name,r.UC_X86_REG_RSI:self.allocate_text(path)})
        self.call(0x147c480,{r.UC_X86_REG_RDI:manager,r.UC_X86_REG_RSI:name})
        result = self.u.reg_read(r.UC_X86_REG_RAX)&255
        if result not in [0,1]:
            raise ValueError('Original file-existence result is not boolean')
        self.call(0x14c2e80,{r.UC_X86_REG_RDI:name})
        return bool(result)

    def imported(self,uc,address,size,user):
        name = self.source.imports[address-self.base]
        first,second,third,fourth = [uc.reg_read(register) for register in
            [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX,r.UC_X86_REG_RCX]]
        if name == '_strerror':
            number = first & 0xffffffff
            if number >= 1<<31:number -= 1<<32
            if 0 <= number < len(self.file_errors):
                if number not in self.file_error_pointers:
                    self.file_error_pointers[number] = self.allocate_text(self.file_errors[number])
                result = self.file_error_pointers[number]
            else:
                # Darwin strerror uses a shared buffer and EINVAL for unknown
                # signed-int values, rather than stopping its caller's loop.
                if self.file_unknown_error is None:self.file_unknown_error = self.allocate(64)
                if self.file_errno is None:self.file_errno = self.allocate(4)
                message = ('Unknown error: '+str(number)).encode()+b'\0'
                uc.mem_write(self.file_unknown_error,message)
                self.put(self.file_errno,'I',22)
                result = self.file_unknown_error
        elif name in ['_strcpy','_strcat']:
            source = self.cstring(second)+b'\0'
            prefix = len(self.cstring(first)) if name == '_strcat' else 0
            if not self.writable_file_memory(first,prefix+len(source)):
                raise ValueError('Native file string copy escaped owned destination')
            uc.mem_write(first+prefix,source)
            result = first
        elif name == '_strncpy':
            if third > 0x10000 or not self.writable_file_memory(first,third):
                raise ValueError('Native file bounded string copy escaped owned destination')
            data = bytearray()
            for index in range(third):
                if not self.library_pointer(second+index,1):
                    raise ValueError('Native file bounded string copy escaped source')
                byte = uc.mem_read(second+index,1)[0]
                data.append(byte)
                if not byte:
                    data.extend(bytes(third-len(data)))
                    break
            if data:uc.mem_write(first,bytes(data))
            result = first
        elif name == '_strncmp':
            if third > 0x10000:
                raise ValueError('Native file bounded string comparison exceeds count bound')
            result = 0
            for index in range(third):
                if not self.library_pointer(first+index,1) or not self.library_pointer(second+index,1):
                    raise ValueError('Native file string comparison escaped owned source')
                a,b = uc.mem_read(first+index,1)[0],uc.mem_read(second+index,1)[0]
                result = a-b
                if result or not a:break
        elif name in ['_strchr','_strrchr']:
            value = self.cstring(first)+b'\0'
            index = value.find(bytes([second&255])) if name == '_strchr' else value.rfind(bytes([second&255]))
            result = first+index if index >= 0 else 0
        elif name == '_dlopen':
            requested = self.cstring(first).decode('utf-8') if first else None
            if requested is not None and str(Path(requested).resolve()).replace('\\','/').lower() != self.file_image_path.lower():
                raise ValueError('Native file requested another dynamic module: '+requested)
            if second != 2:
                raise ValueError('Unadmitted native self-image dynamic loader mode')
            self.file_image_references += 1
            result = self.base
            self.file_calls.append({'name':name,'existingMainImage':True,'references':self.file_image_references})
        elif name == '_dlclose':
            if first != self.base or self.file_image_references <= 0:
                raise ValueError('Native file closed an unowned dynamic module reference')
            self.file_image_references -= 1
            result = 0
        elif name == '_dladdr':
            if not self.base <= first < self.base+len(self.image) or not self.writable_file_memory(second,32):
                raise ValueError('Native image-information query escaped the loaded image/output')
            # The stripped fixture supplies module identity/base. No dynamic
            # symbol table is supplied to this isolated process.
            filename = self.allocate_text(self.file_image_path)
            self.put(second,'QQQQ',filename,self.base,0,0)
            self.file_calls.append({'name':name,'address':first,'imageBase':self.base,'symbolInfoSupplied':False})
            result = 1
        elif name == '_atexit':
            if not self.base <= first < self.base+0x1fef000 or len(self.file_exit_callbacks) >= 128:
                raise ValueError('Native file exit registration escaped original code/count bounds')
            self.file_exit_callbacks.append(first)
            result = 0
        elif name == '_getenv':
            # Explicit empty emulated-process environment. Never expose the
            # host's environment or credentials to the inspected executable.
            variable = self.cstring(first).decode('ascii')
            self.file_environment_queries.append(variable)
            result = 0
        elif name == '_pthread_key_create':
            if (not self.writable_file_memory(first,8) or second and not self.base <= second < self.base+0x1fef000 or
                    len(self.file_keys) >= 128):
                raise ValueError('Native file TLS key escaped owned storage/destructor bounds')
            key = len(self.file_keys)+1
            while key in self.file_keys:key += 1
            self.file_keys[key] = {'value':0,'destructor':second}
            self.put(first,'Q',key)
            result = 0
        elif name in ['_pthread_getspecific','_pthread_setspecific','_pthread_key_delete']:
            if first not in self.file_keys:
                raise ValueError('Native file TLS used an unowned key')
            if name == '_pthread_getspecific':
                result = self.file_keys[first]['value']
            elif name == '_pthread_setspecific':
                # pthread stores an opaque pointer-sized value; the bundled
                # library also uses integer sentinels. This service never
                # dereferences it. Native dereferences retain memory guards.
                self.file_keys[first]['value'] = second
                result = 0
            else:
                del self.file_keys[first]
                result = 0
        elif name == '_pthread_rwlock_init':
            if second or first in self.file_rwlocks or not self.writable_file_memory(first,8):
                raise ValueError('Unadmitted native file read-write lock initialization')
            self.file_rwlocks[first] = {'readers':0,'writer':False}
            result = 0
        elif name in ['_pthread_rwlock_rdlock','_pthread_rwlock_wrlock','_pthread_rwlock_unlock','_pthread_rwlock_destroy']:
            if first not in self.file_rwlocks:
                raise ValueError('Native file used an unowned read-write lock')
            lock = self.file_rwlocks[first]
            if name == '_pthread_rwlock_rdlock':
                if lock['writer']:raise ValueError('Native file read lock reentered a writer')
                lock['readers'] += 1
            elif name == '_pthread_rwlock_wrlock':
                if lock['writer'] or lock['readers']:raise ValueError('Native file write lock reentered')
                lock['writer'] = True
            elif name == '_pthread_rwlock_unlock':
                if lock['writer']:lock['writer'] = False
                elif lock['readers']:lock['readers'] -= 1
                else:raise ValueError('Native file unlocked an unowned read-write lock')
            else:
                if lock['writer'] or lock['readers']:raise ValueError('Native file destroyed an owned read-write lock')
                del self.file_rwlocks[first]
            result = 0
        elif name == '_pthread_once':
            if (not self.base+0x1fef000 <= first <= self.base+len(self.image)-16 or
                    not self.base <= second < self.base+0x1fef000 or len(self.file_once) >= 64):
                raise ValueError('Native archive once initialization escaped original data/code bounds')
            state = self.file_once.get(first)
            if state:
                if state['callback'] != second or not state['complete']:
                    raise ValueError('Native archive once initializer changed or reentered')
                result = 0
            else:
                sp = uc.reg_read(r.UC_X86_REG_RSP)
                state = {'callback':second,'complete':False,'stack':sp}
                self.file_once[first] = state
                def finish_once(engine,at,length,user,control=first):
                    current = self.file_once[control]
                    if current['complete'] or engine.reg_read(r.UC_X86_REG_RSP) != current['stack']:
                        raise ValueError('Native once callback did not restore its original stack')
                    current['complete'] = True
                    engine.reg_write(r.UC_X86_REG_RAX,0)
                    self.ret()
                trampoline = self.allocate_native_callback('pthread-once', finish_once)
                state['trampoline'] = trampoline
                self.put(sp-8,'Q',trampoline)
                uc.reg_write(r.UC_X86_REG_RSP,sp-8)
                uc.reg_write(r.UC_X86_REG_RIP,second)
                return
        elif name == '___error':
            if self.file_errno is None:self.file_errno = self.allocate(4)
            result = self.file_errno
        elif name == '_mmap':
            fifth,sixth = uc.reg_read(r.UC_X86_REG_R8),uc.reg_read(r.UC_X86_REG_R9)
            if (first or second != 0x20000000 or third != 0 or fourth != 0x1002 or
                    fifth & 0xffffffff != 0xffffffff or sixth or self.file_mappings):
                raise ValueError('Unadmitted original anonymous allocator mapping')
            result = 0x20000000
            uc.mem_map(result,second,unicorn.UC_PROT_NONE)
            self.file_mappings.append((result,second))
            self.file_calls.append({'name':name,'address':result,'bytes':second,'protection':third,'flags':fourth})
        elif name == '_mprotect':
            if (first % 4096 or second % 4096 or third not in [0,1,3] or
                    not any(start <= first <= start+length-second for start,length in self.file_mappings)):
                raise ValueError('Native allocator protection escaped owned non-executable mapping')
            uc.mem_protect(first,second,third)
            result = 0
            self.file_calls.append({'name':name,'address':first,'bytes':second,'protection':third})
        elif name == '_memcmp':
            if third > 0x800000 or not self.library_pointer(first,third) or not self.library_pointer(second,third):
                raise ValueError('Native archive comparison escaped owned byte ranges')
            a,b = bytes(uc.mem_read(first,third)),bytes(uc.mem_read(second,third))
            result = next((x-y for x,y in zip(a,b) if x != y),0)
        elif name == '___bzero' and second >= 0x100000:
            if second > 0x800000 or not any(at <= first <= at+length-second for at,length in self.allocations.items()):
                raise ValueError('Native archive zero fill escaped owned allocation')
            uc.mem_write(first,bytes(second))
            result = 0
        elif name == '_malloc':
            result = self.allocate(first)
        elif name == '_free':
            if first and first not in self.allocations:
                raise ValueError('Native file free escaped owned allocation')
            result = 0
        elif name == '_realloc':
            if first and first not in self.allocations or not second:
                raise ValueError('Unadmitted native file reallocation')
            result = self.allocate(second)
            if first:
                amount = min(self.allocations[first],second)
                uc.mem_write(result,bytes(uc.mem_read(first,amount)))
        elif name == '_fopen':
            path,mode = self.cstring(first).decode('utf-8'),self.cstring(second)
            if mode != b'rb':
                raise ValueError('Native file bridge permits binary reads only')
            key = str(Path(path).resolve()).replace('\\','/').lower()
            if key not in self.allowed_files:
                raise ValueError('Native code requested an unapproved file: '+path)
            result = self.allocate(0x20)
            self.file_handles[result] = self.allowed_files[key].open('rb')
            self.file_calls.append({'name':name,'path':str(self.allowed_files[key]),'handle':result})
        elif name == '_fread':
            if fourth not in self.file_handles or second*third > 0x800000:
                raise ValueError('Native file read exceeds its open handle/count bound')
            amount = second*third
            if not self.writable_file_memory(first,amount):
                raise ValueError('Native file read destination escaped owned memory')
            data = self.file_handles[fourth].read(amount)
            if data:uc.mem_write(first,data)
            result = len(data)//second if second else 0
            self.file_calls.append({'name':name,'handle':fourth,'requested':amount,'read':len(data)})
        elif name in ['_fseek','_fseeko']:
            if first not in self.file_handles or third not in [0,1,2]:
                raise ValueError('Native file seek escaped its handle/origin bound')
            offset = second-(1<<64) if second >= 1<<63 else second
            self.file_handles[first].seek(offset,third)
            result = 0
            self.file_calls.append({'name':name,'handle':first,'offset':offset,'origin':third})
        elif name in ['_ftell','_ftello']:
            if first not in self.file_handles:
                raise ValueError('Native file tell used an unowned handle')
            result = self.file_handles[first].tell()
        elif name == '_fclose':
            if first not in self.file_handles:
                raise ValueError('Native file close used an unowned handle')
            self.file_handles.pop(first).close()
            result = 0
        else:
            return super().imported(uc,address,size,user)
        uc.reg_write(r.UC_X86_REG_RAX,result&0xffffffffffffffff)
        self.ret()

    def close_files(self):
        for stream in self.file_handles.values():stream.close()
        self.file_handles = {}
