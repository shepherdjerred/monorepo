"""Read-only prepared-file mount for the original resource loaders.

Original path normalization, filesystem lookup, memory-file constructor/read/
seek/size methods, stream forwarding and asset parsers execute unchanged. The
archive-entry open interface supplies real prepared bytes; WAD/OS I/O is not
executed. The port owns file-handle allocation and release, not game resources.
"""
import struct
import unicorn
from unicorn import x86_const as r
from vfx_pipeline_native import NativeVfxPipelineContext
from vfx_spawn_native import ADDRESSES as A,sha

FILE_RETURN=0x100f5000
FILE_RELEASE=0x100f5010
FILE_RELEASE_RETURN=0x100f5020
FILE_VTABLE=0x100f5100


class NativeVfxFileContext(NativeVfxPipelineContext):
    def __init__(self,*args,**kwargs):
        self.filesystem=None;self.file_mutex=None
        super().__init__(*args,**kwargs)
        for address,callback in [(FILE_RETURN,self.file_return),(FILE_RELEASE,self.file_release),
                (FILE_RELEASE_RETURN,self.file_release_return)]:
            self.u.mem_write(address,b'\xc3');self.u.hook_add(unicorn.UC_HOOK_CODE,callback,begin=address,end=address)
        for at,callback in [(0x147b3c0,self.open_archive_entry),(0x147c110,self.observe_lookup),
                (0x1479130,self.observe_read),(0x1479165,self.observe_read)]:
            self.u.hook_add(unicorn.UC_HOOK_CODE,callback,begin=self.base+at,end=self.base+at)
        self.u.mem_write(FILE_VTABLE,bytes(self.u.mem_read(self.base+0x23de258,0x40)))
        self.put(FILE_VTABLE+8,'Q',FILE_RELEASE)

    def load_prepared_system(self,graph):
        if getattr(self,'file_index_hook',None) is not None:self.u.hook_del(self.file_index_hook)
        super().load_prepared_system(graph)
        self.filesystem=None;self.file_mutex=None;self.archive=None
        self.static_files={};self.file_rows={};self.file_buffers={};self.file_handles={}
        self.file_lookups=[];self.file_opens=[];self.file_reads=[];self.file_closes=[]
        self.pending_file=None;self.pending_file_release=None;self.pending_file_reads=[]
        self.file_index_hook=None

    def imported(self,uc,address,size,user):
        name=self.source.imports[address-self.base];first=self.u.reg_read(r.UC_X86_REG_RDI)
        if self.filesystem is not None and first==self.filesystem+8 and name in [
                '_pthread_mutex_init','_pthread_mutex_lock','_pthread_mutex_unlock']:
            if name=='_pthread_mutex_init':
                attrs=self.u.reg_read(r.UC_X86_REG_RSI)
                if self.file_mutex is not None or self.object_attrs.get(attrs)!=2:
                    raise ValueError('Invalid owned filesystem recursive mutex initialization')
                self.file_mutex={'recursive':True,'depth':0}
            elif self.file_mutex is None:raise ValueError('Owned filesystem mutex is not initialized')
            elif name=='_pthread_mutex_lock':self.file_mutex['depth']+=1
            else:
                if not self.file_mutex['depth']:raise ValueError('Unlock of unowned filesystem mutex')
                self.file_mutex['depth']-=1
            self.object_os_calls.append({'name':name,'owner':'prepared-filesystem',**self.file_mutex})
            self.u.reg_write(r.UC_X86_REG_RAX,0);self.ret();return
        return super().imported(uc,address,size,user)

    def initialize_graphics_context(self,quality,graphics34b):
        state=super().initialize_graphics_context(quality,graphics34b)
        self.filesystem=self.allocate(0x70,0xa5)
        self.call(0x147bb10,{r.UC_X86_REG_RDI:self.filesystem})
        if self.q(self.base+0x246d7b0)!=self.filesystem or self.file_mutex['depth']:
            raise ValueError('Original filesystem constructor publication differs')
        return state

    def install_static_files(self,files):
        if not files or self.static_files or self.filesystem is None:
            raise ValueError('Fresh owned filesystem and exact prepared file bytes required')
        entries=[]
        for path,source in files.items():
            raw=source['bytes']
            if (not isinstance(path,str) or path!=path.lower().replace('\\','/') or
                    not isinstance(raw,bytes) or not 0<len(raw)<0x100000 or sha(raw)!=source['sha256']):
                raise ValueError('Invalid prepared file path/bytes/hash')
            text=path.encode('utf-8');pointer=self.allocate(len(text)+1);self.u.mem_write(pointer,text+b'\0')
            wrapper=self.allocate(16);self.put(wrapper,'QII',pointer,len(text),len(text)+1)
            # Exact independent normalization/hash prefix of the native open
            # function, stopping before filesystem lookup.
            self.fragment(0x1479e43,0x1479ebf,{r.UC_X86_REG_RSI:wrapper,
                r.UC_X86_REG_RBP:A['stack']-8,r.UC_X86_REG_RSP:A['stack']-0x158})
            key=self.u.reg_read(r.UC_X86_REG_R15)
            if key in self.static_files:raise ValueError('Ambiguous prepared file hash')
            record={'path':path,'sha256':source['sha256'],'bytes':raw,'key':key}
            self.static_files[key]=record;entries.append(record)
        entries.sort(key=lambda e:e['key']);rows=self.allocate(len(entries)*32)
        for i,entry in enumerate(entries):
            row=rows+i*32;self.put(row,'Q',entry['key']);self.put(row+0x10,'I',len(entry['bytes']))
            self.file_rows[row]=entry
        # A compiled, fully indexed read-only archive view. Only the declared
        # key and logical-size fields may be consumed from its index rows.
        self.archive=self.allocate(0x60);self.put(self.archive+0x48,'B',1)
        self.put(self.archive+0x50,'QII',rows,len(entries),len(entries))
        mounts=self.allocate(8);self.put(mounts,'Q',self.archive)
        self.put(self.filesystem+0x48,'QII',mounts,1,1)
        self.file_index_hook=self.u.hook_add(unicorn.UC_HOOK_MEM_READ,self.check_index_read,
            begin=rows,end=rows+len(entries)*32-1,user_data=rows)
        return [{'path':e['path'],'key':e['key'],'sha256':e['sha256'],'bytes':len(e['bytes'])} for e in entries]

    def check_index_read(self,uc,access,address,size,value,start):
        offset=(address-start)%32
        if not (0<=offset<offset+size<=8 or 16<=offset<offset+size<=20):
            raise ValueError(f'Undeclared prepared archive index field: +0x{offset:x}/{size}')

    def observe_lookup(self,uc,address,size,user):
        if self.u.reg_read(r.UC_X86_REG_RDI)!=self.filesystem:
            raise ValueError('Unowned native filesystem lookup')
        key=self.u.reg_read(r.UC_X86_REG_RSI);flags=self.u.reg_read(r.UC_X86_REG_RDX)
        record={'key':key,'flags':flags,'returnRva':self.q(self.u.reg_read(r.UC_X86_REG_RSP))-self.base}
        self.file_lookups.append(record)
        if key not in self.static_files:raise ValueError(f'Unprepared native file hash: 0x{key:016x}')
        record['path']=self.static_files[key]['path']

    def open_archive_entry(self,uc,address,size,user):
        archive=self.u.reg_read(r.UC_X86_REG_RDI);row=self.u.reg_read(r.UC_X86_REG_RSI)
        flags=self.u.reg_read(r.UC_X86_REG_RDX)
        if self.pending_file is not None or archive!=self.archive or row not in self.file_rows or flags not in [0,1]:
            raise ValueError('Unowned prepared archive open')
        source=self.file_rows[row]
        if source['key'] not in self.file_buffers:
            data=self.allocate(len(source['bytes']));self.u.mem_write(data,source['bytes'])
            self.file_buffers[source['key']]=data
        data=self.file_buffers[source['key']];pointer=self.allocate(0x28,0xa5)
        sp=self.u.reg_read(r.UC_X86_REG_RSP)
        self.pending_file={'pointer':pointer,'data':data,'source':source,'stack':sp,'flags':flags}
        frame=sp-0x10;self.put(frame,'Q',FILE_RETURN)
        for reg,value in [(r.UC_X86_REG_RDI,pointer),(r.UC_X86_REG_RSI,data),
                (r.UC_X86_REG_RDX,len(source['bytes'])),(r.UC_X86_REG_RCX,0),
                (r.UC_X86_REG_RSP,frame),(r.UC_X86_REG_RIP,self.base+0x1478f60)]:self.u.reg_write(reg,value)

    def file_return(self,uc,address,size,user):
        pending=self.pending_file
        if pending is None:raise ValueError('Unexpected memory-file constructor continuation')
        pointer=pending['pointer'];source=pending['source']
        if (self.q(pointer)!=self.base+0x23de258 or self.q(pointer+8)!=pending['data'] or
                self.q(pointer+0x10)!=len(source['bytes']) or self.q(pointer+0x18) or self.u.mem_read(pointer+0x20,1)!=b'\0'):
            raise ValueError('Original memory-file constructor differs')
        self.put(pointer,'Q',FILE_VTABLE)
        record={'pointer':pointer,'data':pending['data'],'path':source['path'],'sha256':source['sha256'],
            'bytes':len(source['bytes']),'flags':pending['flags'],'closed':False,
            'headerHex':bytes(self.u.mem_read(pointer,0x28)).hex()}
        self.file_handles[pointer]=record;self.file_opens.append(record)
        self.u.reg_write(r.UC_X86_REG_RSP,pending['stack']);self.u.reg_write(r.UC_X86_REG_RAX,pointer)
        self.pending_file=None;self.ret()

    def observe_read(self,uc,address,size,user):
        if address==self.base+0x1479130:
            pointer=self.u.reg_read(r.UC_X86_REG_RDI);handle=self.file_handles.get(pointer)
            if handle is None or handle['closed']:raise ValueError('Read from an unowned/closed prepared file')
            cursor=self.q(pointer+0x18);count=self.u.reg_read(r.UC_X86_REG_RDX)
            if not 0<=cursor<=handle['bytes']:raise ValueError('Prepared memory-file cursor exceeds bytes')
            self.pending_file_reads.append({'pointer':pointer,'path':handle['path'],'offset':cursor,
                'requested':count,'bytes':min(count,handle['bytes']-cursor),'destination':self.u.reg_read(r.UC_X86_REG_RSI)})
        else:
            read=self.pending_file_reads.pop();handle=self.file_handles[read['pointer']]
            actual=self.u.reg_read(r.UC_X86_REG_RAX)
            data=bytes(self.u.mem_read(read['destination'],read['bytes']))
            source=bytes(self.u.mem_read(handle['data']+read['offset'],read['bytes']))
            if actual!=read['bytes'] or data!=source or self.q(read['pointer']+0x18)!=read['offset']+actual:
                raise ValueError('Original memory-file read differs from prepared source')
            read['sha256']=sha(data);self.file_reads.append(read)

    def file_release(self,uc,address,size,user):
        pointer=self.u.reg_read(r.UC_X86_REG_RDI);handle=self.file_handles.get(pointer)
        if (self.pending_file_release is not None or handle is None or handle['closed'] or
                self.u.mem_read(pointer+0x20,1)!=b'\0' or not self.file_mutex['depth']):
            raise ValueError('Unowned prepared memory-file release')
        sp=self.u.reg_read(r.UC_X86_REG_RSP);self.pending_file_release={'pointer':pointer,'stack':sp}
        frame=sp-0x10;self.put(frame,'Q',FILE_RELEASE_RETURN)
        self.u.reg_write(r.UC_X86_REG_RSP,frame);self.u.reg_write(r.UC_X86_REG_RIP,self.base+0x14755a0)

    def file_release_return(self,uc,address,size,user):
        pending=self.pending_file_release
        if pending is None:raise ValueError('Unexpected prepared file release continuation')
        handle=self.file_handles[pending['pointer']];handle['closed']=True
        self.file_closes.append({'pointer':pending['pointer'],'path':handle['path'],
            'cursor':self.q(pending['pointer']+0x18),'bytes':handle['bytes']})
        self.u.reg_write(r.UC_X86_REG_RSP,pending['stack']);self.pending_file_release=None;self.ret()
