"""Bounded read-only tracing of original context/global resource producers.

Install before startup. Absence from this transcript is not proof that an actual
replay lacks a producer: the fixture startup itself may still be incomplete.
Pointers and serialized tokens are retained without asserting asset readiness.
"""
from copy import deepcopy
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import sha


def resource_publication_trace_sources():
    return {Path(__file__).resolve()}


class ResourcePublicationTrace:
    def __init__(self, n):
        self.n = n
        self.events = []
        self.total_rows = 0
        self.hooks = []
        self.maximum_events = 16384
        self.maximum_total_rows = 1000000
        self.ranges = [(0x16154a0,0x16154a8),(0x89dbd0,0x89dbda),
                       (0x3783b0,0x3783c0),(0x1615960,0x1615970),
                       (0x353c3e,0x353c55)]
        for a,b in self.ranges:
            if n.image[a:b] != n.source.image[a:b]:
                raise ValueError('Resource trace needs pristine original hook instructions')
        for at,method in [(0x16154a0,self.merge),(0x89dbd0,self.publish),
                          (0x3783b0,self.publish_global),(0x1615960,self.register_values),
                          (0x353c3e,self.publish_context)]:
            self.hooks.append(n.u.hook_add(unicorn.UC_HOOK_CODE,method,
                begin=n.base+at,end=n.base+at))

    def owned(self, address, size):
        if not self.n.library_pointer(address,size):
            raise ValueError('Resource publication trace escaped owned original data')

    def caller(self):
        n=self.n
        stack=n.u.reg_read(r.UC_X86_REG_RSP)
        address=n.q(stack)
        return address-n.base if n.base<=address<n.base+len(n.image) else None

    def append(self, kind, rva, **fields):
        if len(self.events)>=self.maximum_events:
            raise ValueError('Resource publication trace exceeded explicit event bound')
        self.events.append({'sequence':len(self.events),'kind':kind,'rva':rva,**fields})

    def rows(self, resolver):
        n=self.n
        self.owned(resolver,24)
        count,table=n.u32(resolver+0x10),n.q(resolver+8)
        if count>65536 or self.total_rows+count>self.maximum_total_rows:
            raise ValueError('Resource publication trace exceeded explicit row bound')
        if count:self.owned(table,count*16)
        result=[{'key':n.u32(table+i*16),'valuePointerOrToken':n.q(table+i*16+8)}
                for i in range(count)]
        if any(a['key']>b['key'] for a,b in zip(result,result[1:])):
            raise ValueError('Original traced resource rows are not unsigned sorted')
        self.total_rows+=count
        return result

    def collection(self):
        owner=self.n.q(self.n.base+0x246efe8)
        if owner:self.owned(owner,0x40)
        return owner

    def merge(self, uc, address, size, user):
        n=self.n
        owner=self.collection()
        if not owner or uc.reg_read(r.UC_X86_REG_RDI)!=owner+0x28:return
        source=uc.reg_read(r.UC_X86_REG_RSI)
        self.append('global0-merge-entered',0x16154a0,callerReturnRva=self.caller(),
                    collection=owner,source=source,sourceRows=self.rows(source),
                    destinationRowsBefore=self.rows(owner+0x28))

    def publish(self, uc, address, size, user):
        n=self.n
        owner=self.collection()
        if not owner or uc.reg_read(r.UC_X86_REG_RDI)!=owner:return
        self.append('global0-publication-entered',0x89dbd0,
                    callerReturnRva=self.caller(),collection=owner,
                    mergedRows=self.rows(owner+0x28),
                    componentBefore=n.q(n.base+0x24a8560))

    def publish_global(self, uc, address, size, user):
        index=uc.reg_read(r.UC_X86_REG_RDI)&0xffffffff
        if index not in [0,1]:return
        component=uc.reg_read(r.UC_X86_REG_RSI)
        fields={'globalIndex':index,'component':component,'callerReturnRva':self.caller(),
                'previousComponent':self.n.q(self.n.base+0x24a8560+index*8)}
        if component:
            self.owned(component,0x30)
            fields.update(baseResolver=self.n.q(component+0x10),
                          overlaysBegin=self.n.q(component+0x18),
                          overlaysEnd=self.n.q(component+0x20))
        self.append('global-component-publication-entered',0x3783b0,**fields)

    def register_values(self, uc, address, size, user):
        owner=self.collection()
        if not owner or uc.reg_read(r.UC_X86_REG_RDI)!=owner+0x28:return
        self.append('global0-asset-registration-entered',0x1615960,
                    collection=owner,rows=self.rows(owner+0x28))

    def string(self, address):
        n=self.n
        self.owned(address,24)
        first=bytes(n.u.mem_read(address,1))[0]
        count=n.q(address+8) if first&1 else first>>1
        pointer=n.q(address+16) if first&1 else address+1
        if count>4096:raise ValueError('Resource trace original string exceeds bound')
        if count:self.owned(pointer,count)
        data=bytes(n.u.mem_read(pointer,count))
        return {'bytesHex':data.hex(),'ascii':data.decode('ascii') if all(0<b<128 for b in data) else None}

    def publish_context(self, uc, address, size, user):
        n=self.n
        context,node,registry=[uc.reg_read(reg) for reg in
                               [r.UC_X86_REG_R14,r.UC_X86_REG_RBX,r.UC_X86_REG_R15]]
        self.owned(context,0x90)
        self.owned(node,0x30)
        self.owned(registry,0xc0)
        if n.q(node+0x28)!=context or n.u32(node+0x20)!=n.u32(context+0x48):
            raise ValueError('Original context publication trace identity/store differs')
        self.append('character-context-registry-store-completed',0x353c3e,
                    registry=registry,context=context,identity=n.u32(context+0x48),
                    skinId=n.u32(context+0x28),name=self.string(context+0x10),
                    namespace=self.string(context+0x30),resolver=n.q(context+0x60),
                    loadAttemptByte=bytes(n.u.mem_read(context+0x68,1))[0])

    def snapshot(self):
        return {'schema':1,'kind':'original-resource-publication-readonly-trace',
                'events':deepcopy(self.events),'capturedRows':self.total_rows,
                'maximumEvents':self.maximum_events,'maximumTotalRows':self.maximum_total_rows,
                'originalHookBlocks':[{'rva':a,'size':b-a,'sha256':sha(self.n.image[a:b])}
                                      for a,b in self.ranges],
                'scope':{'readOnlyOriginalInstructionHooks':True,
                         'startedBeforeStartupRequired':True,
                         'eventEntryIsNotCompletion':True,
                         'completeActualReplayStartupEstablished':False,
                         'nativeValuePointersAreNotReadiness':True,
                         'actualEffectsActivated':False}}

    def close(self):
        for hook in self.hooks:self.n.u.hook_del(hook)
        self.hooks=[]


def install_resource_publication_trace(n):
    return ResourcePublicationTrace(n)
