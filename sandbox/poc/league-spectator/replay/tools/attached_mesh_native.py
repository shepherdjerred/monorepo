"""Original attached-mesh submesh cache and draw-mask components.

Complete post-loaded asset bytes and resolved SKN resources are supplied inputs.
Resource-map construction, cached mask resolution and draw-mask combination run
unchanged. Owner lookup, resource acquisition, particle simulation and graphics
submission are not executed by this component.
"""
import struct
import unicorn
from unicorn import x86_const as r
from submesh_visibility_native import NativeSubmeshVisibility,O
from vfx_spawn_native import ADDRESSES as A

ACTOR,LINK,SYSTEM,CONTEXT,BUNDLE2,RESOURCE2,RANGES2,VECTOR2=0x10060000,0x10061000,0x10062000,0x10064000,0x10066000,0x10070000,0x10071000,0x10073000
FRAME=0x10018000
BLOCKS=[(0x17567fb,0x1756802),(0x175683d,0x1756847),(0x175686b,0x1756879),
 (0x1756f8e,0x17570fa),(0x173d436,0x173d4f0),
 (0x173fde7,0x173fe02),(0x173fe0a,0x173fe0d),(0x177ac50,0x177ac5a),
 (0x23f6d30,0x23f6e78)]

class NativeAttachedMesh(NativeSubmeshVisibility):
 def load_attached(self,names,state,alternate_names=None):
  self.reset(names,[])
  obj=bytes.fromhex(state['objectHex']);heap=bytes.fromhex(state['heapHex']);start=state['heapStart']
  if state['phase']!='native-postload-callbacks-executed'or state['pendingLinkFixups']or state['mathCalls']or len(obj)!=0x470 or self.next_heap>start or start+len(heap)>=0x12000000:raise ValueError('Invalid complete attached-mesh asset state')
  primitive=struct.unpack_from('<Q',obj,0x60)[0]
  if not any(v['object']==primitive and v['type']==0xa4aea2a5 for v in state['visits']):raise ValueError('Not an authored attached mesh')
  self.u.mem_write(A['definition'],obj);self.u.mem_write(start,heap)
  if self.q(primitive)!=self.base+0x23f6d30 or self.u.mem_read(primitive+8,1)!=b'\x0b':raise ValueError('Attached primitive vtable/type changed')
  # A second original resource map exercises actual resource-identity changes.
  alternate_names=alternate_names or list(reversed(names))
  for at,size in [(RESOURCE2,0x200),(RANGES2,0x2000),(VECTOR2,16),(BUNDLE2,0x100)]:self.u.mem_write(at,bytes(size))
  for i,name in enumerate(alternate_names):self.u.mem_write(RANGES2+i*0x78,name.encode()+b'\0')
  self.put(VECTOR2,'QII',RANGES2,len(alternate_names),len(alternate_names));self.put(A['stack']+8,'QQ',0,0)
  self.call(0x18539f0,{r.UC_X86_REG_RDI:RESOURCE2,r.UC_X86_REG_RSI:O['name'],r.UC_X86_REG_RDX:VECTOR2,r.UC_X86_REG_RCX:0,r.UC_X86_REG_R8:0,r.UC_X86_REG_R9:O['matrix']})
  if self.next_heap>start:raise ValueError('Owned mesh maps overlap the loaded asset arena')
  self.put(BUNDLE2+0x10,'Q',RESOURCE2)
  for at,size in [(ACTOR,0x200),(LINK,0x200),(SYSTEM,0x200),(CONTEXT,0x200)]:self.u.mem_write(at,bytes(size))
  self.put(ACTOR,'QQ',SYSTEM,LINK);self.put(LINK+0x10,'Q',A['definition']);self.put(SYSTEM+0x38,'Q',CONTEXT)
  self.call(0x17567fb,{r.UC_X86_REG_RDI:ACTOR},0x1756802)
  self.call(0x175683d,{r.UC_X86_REG_RDI:ACTOR},0x1756847)
  self.call(0x175686b,{r.UC_X86_REG_RDI:ACTOR,r.UC_X86_REG_XMM0:0},0x1756879)
  self.primitive=primitive;self.names=[names,alternate_names]
  mesh=primitive+0x10
  def hashes(offset):
   pointer,count=self.q(mesh+offset),self.u32(mesh+offset+8)
   if count>1024 or count and not start<=pointer<=start+len(heap)-count*4:raise ValueError('Attached mask vector outside its loaded asset')
   return list(struct.unpack('<'+'I'*count,self.u.mem_read(pointer,count*4)))if count else []
  return {'drawHashes':hashes(0x30),'alwaysHashes':hashes(0x40),'useAvatarMask':bool(self.u.mem_read(primitive+0x8b,1)[0]),'lockMeshToAttachment':bool(self.u.mem_read(mesh+0x50,1)[0])}

 def u32(self,at):return struct.unpack('<I',self.u.mem_read(at,4))[0]
 def cache(self,resource):
  if resource not in [0,1,2]:raise ValueError('Unowned attached resource')
  resolved=[0,O['bundle'],BUNDLE2][resource]
  self.call(0x1756fce if resource==0 else 0x1756f8e,{r.UC_X86_REG_R15:ACTOR,r.UC_X86_REG_R14:resolved,r.UC_X86_REG_RBP:FRAME},0x17570fa)
  return {'resource':resource,'selectedMask':self.u32(ACTOR+0x74),'alwaysMask':self.u32(ACTOR+0xdc)}

 def combine(self,owner_mask):
  self.call(0x173d4d5,{r.UC_X86_REG_R15:ACTOR,r.UC_X86_REG_R14:owner_mask},0x173d4f0)
  return self.u.reg_read(r.UC_X86_REG_R14D)

 def combine_second_pass(self,owner_mask):
  self.call(0x173fde7,{r.UC_X86_REG_RBX:ACTOR,r.UC_X86_REG_R14:owner_mask},0x173fdff)
  pointer=self.u.reg_read(r.UC_X86_REG_RBX);first=self.u.reg_read(r.UC_X86_REG_R14D)
  self.call(0x173fdff,{r.UC_X86_REG_RBX:pointer},0x173fe02);second=self.u.reg_read(r.UC_X86_REG_R13D)
  self.call(0x173fe0a,{r.UC_X86_REG_R13D:second,r.UC_X86_REG_R14D:first},0x173fe0d)
  return self.u.reg_read(r.UC_X86_REG_R13D)

 def mask_channel(self,value):
  self.put(self.primitive+0x8b,'B',value)
  stops=[0x173d45d,0x173d498];hooks=[]
  for stop in stops:hooks.append(self.u.hook_add(unicorn.UC_HOOK_CODE,lambda uc,address,size,user:uc.emu_stop(),begin=self.base+stop,end=self.base+stop))
  self.u.context_restore(self.initial);self.put(A['stack'],'Q',A['stop']);self.u.reg_write(r.UC_X86_REG_RSP,A['stack']);self.u.reg_write(r.UC_X86_REG_RAX,self.primitive)
  try:self.u.emu_start(self.base+0x173d442,A['stop'],count=5000000)
  finally:
   for hook in hooks:self.u.hook_del(hook)
  pc=self.u.reg_read(r.UC_X86_REG_RIP)-self.base
  if pc not in stops:raise ValueError('Unadmitted attached owner-mask route')
  return 1 if pc==stops[0]else 0
