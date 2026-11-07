"""Original submesh resource map, event constructors, scheduler and mask setters.

Named SKN ranges are supplied in their original order as owned resource inputs.
The complete resource constructor builds its own balanced name-to-bit tree.
An owned context uses the actual client interface vtable and mask storage.
No game callback is replaced by a sink. Actor creation, full animation graph
transitions and graphics submission are outside this component.
"""
import math,struct
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn,ADDRESSES as A,name_hash
from vfx_uv_native import registrations

O={'resource':0x10050000,'ranges':0x10051000,'vector':0x10053000,
   'context':0x10054000,'wrapper':0x10055000,'bundle':0x10056000,
   'name':0x10057000,'matrix':0x10058000}
BLOCKS=[(0x15bc600,0x15bc6e0),(0x15dc8e0,0x15dc919),
 (0x1595870,0x1595a10),(0x18539f0,0x1853c5c),(0x184a7e0,0x184a826),
 (0x368ed0,0x368eea),(0x368f70,0x368f8a),(0x368fb0,0x368fca),
 (0x1589270,0x1589e90),(0x158cff0,0x158d600),
 (0x231bd70,0x231bd98),(0x23e33e0,0x23e3478)]

def finite(v):return type(v)in(int,float)and math.isfinite(v)and math.isfinite(struct.unpack('<f',struct.pack('<f',v))[0])

class NativeSubmeshVisibility(NativeSpawn):
 def __init__(self,package,client):
  super().__init__(package,client)
  self.layout=registrations(self.image,0x15bc600,0x15bc6e0,{
   'mShowSubmeshList':(0x18,0,'vector-hash',0),'mHideSubmeshList':(0x28,0,'vector-hash',0),
   'ApplyOnlyToAvatarMeshes':(0x38,1,'boolean',False)})
  self.base_layout=registrations(self.image,0x15bb710,0x15bb800,{
   'mStartFrame':(0xc,1,'float',0),'mEndFrame':(0x10,1,'float',-1),
   'mFireIfAnimationEndsEarly':(9,1,'boolean',False)})
  for start,end in BLOCKS:
   if self.image[start:end]!=self.source.image[start:end]:raise ValueError('Submesh original code differs')
  self.call(0x15dc8e0,{r.UC_X86_REG_RDI:A['definition']})
  self.defaults=bytes(self.u.mem_read(A['definition'],0x40))
  if struct.unpack_from('<ff',self.defaults,0xc)!=(0,-1)or self.defaults[0x38]:raise ValueError('Submesh defaults differ')

 def reset(self,names,specs,initial=0xffffffff,avatar=0xffffffff):
  if not names or len(names)>32 or any(not isinstance(x,str)or not x or len(x.encode())>=64 for x in names):raise ValueError('Invalid owned SKN ranges')
  self.next_heap=0x10400000;self.allocations={}
  for name,size in [('resource',0x200),('ranges',0x2000),('vector',16),('context',0x200),('wrapper',0x100),('bundle',0x100),('name',16),('matrix',64)]:self.u.mem_write(O[name],bytes(size))
  for i,name in enumerate(names):self.u.mem_write(O['ranges']+i*0x78,name.encode()+b'\0')
  self.put(O['vector'],'QII',O['ranges'],len(names),len(names))
  self.put(A['stack']+8,'QQ',0,0)
  self.call(0x18539f0,{r.UC_X86_REG_RDI:O['resource'],r.UC_X86_REG_RSI:O['name'],r.UC_X86_REG_RDX:O['vector'],r.UC_X86_REG_RCX:0,r.UC_X86_REG_R8:0,r.UC_X86_REG_R9:O['matrix']})
  self.mapping={}
  for name in set(names):
   self.call(0x184a7e0,{r.UC_X86_REG_RDI:O['resource'],r.UC_X86_REG_ESI:name_hash(name)})
   self.mapping[name]=self.u.reg_read(r.UC_X86_REG_EAX)
   if self.mapping[name]!=sum(1<<i for i,n in enumerate(names)if name_hash(n)==name_hash(name)):raise ValueError('Native name-to-bit map differs')
  self.put(O['context'],'Q',self.base+0x231bd70);self.put(O['context']+0x38,'Q',O['wrapper']);self.put(O['wrapper']+0x90,'Q',O['bundle']);self.put(O['bundle']+0x10,'Q',O['resource'])
  self.put(O['context']+0xa0,'II',initial,avatar)
  self.u.mem_write(A['manager'],bytes(0x50));self.specs=specs;self.runtimes=[]
  for index,spec in enumerate(specs):
   if any(not finite(spec.get(k,default))for k,default in [('startFrame',0),('endFrame',-1)]):raise ValueError('Invalid event clock')
   data=self.allocate(0x40);self.call(0x15dc8e0,{r.UC_X86_REG_RDI:data})
   self.put(data+0xc,'ff',spec.get('startFrame',0),spec.get('endFrame',-1));self.put(data+9,'B',spec.get('fireIfEarly',False));self.put(data+0x38,'B',spec.get('avatarOnly',False))
   for key,off in [('show',0x18),('hide',0x28)]:
    values=[name_hash(n)for n in spec.get(key,[])];vector=self.allocate(max(8,4*len(values)))
    if values:self.put(vector,'I'*len(values),*values)
    self.put(data+off,'QII',vector,len(values),len(values))
   runtime=self.allocate(0x38);self.call(0x1595870,{r.UC_X86_REG_RDI:runtime,r.UC_X86_REG_RSI:data,r.UC_X86_REG_EDX:index,r.UC_X86_REG_R8:O['context']})
   if self.q(runtime)!=self.base+0x23e33e0:raise ValueError('Unexpected submesh runtime')
   self.runtimes.append(runtime)
  vector=self.allocate(max(8,8*len(self.runtimes)))
  if self.runtimes:self.put(vector,'Q'*len(self.runtimes),*self.runtimes)
  self.put(A['manager']+0x20,'QI',vector,len(self.runtimes));self.last=None
  return {'mapping':self.mapping,'masks':self.masks()}

 def masks(self):return list(struct.unpack('<II',self.u.mem_read(O['context']+0xa0,8)))
 def step(self,frame,resync=False):
  if not finite(frame)or(not resync and self.last is not None and frame<self.last):raise ValueError('Invalid submesh frame ordering')
  self.call(0x1589270,{r.UC_X86_REG_RDI:A['manager'],r.UC_X86_REG_RSI:O['context'],r.UC_X86_REG_EDX:int(resync),r.UC_X86_REG_XMM0:int.from_bytes(struct.pack('<f',frame),'little')});self.last=frame
  return {'masks':self.masks(),'states':[{'event':spec['id'],'bytes':bytes(self.u.mem_read(at+0x10,12)).hex()}for spec,at in zip(self.specs,self.runtimes)]}
