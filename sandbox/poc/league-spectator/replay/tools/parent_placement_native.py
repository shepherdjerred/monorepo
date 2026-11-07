"""Original object placement setters and non-ticking object-to-parent sync.

Input vectors/matrices are explicit caller data. Entity/bone providers and the
mapping from decoded replay fields to these setters are separate contracts.
"""
import math
import struct
import unicorn
from unicorn import x86_const as r
from vfx_parent_frames_native import NativeVfxParentFrames

POSE_INPUT=0x100e5000
SETTERS={'initialPosition':0x17671b0,'position':0x1755d10,
    'secondaryPosition':0x1767180,'basis':0x1755d40,'direction':0x1767230}
SYNC=0x1765a50


class NativeParentPlacement(NativeVfxParentFrames):
    def __init__(self,*args,**kwargs):
        self.in_placement_sync=False
        super().__init__(*args,**kwargs)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.guard_sync_tick,begin=self.base+0x1763220,end=self.base+0x1763220)

    def guard_sync_tick(self,uc,address,size,user):
        if self.in_placement_sync:raise ValueError('Placement propagation attempted to advance parent simulation')

    def capture_parent_substep(self,uc,address,size,user):
        if self.in_placement_sync:raise ValueError('Placement propagation attempted to advance emitter simulation')
        return super().capture_parent_substep(uc,address,size,user)

    def apply_placement(self,obj,pose,initial=False):
        if obj not in self.object_addresses or self.in_parent_tick:raise ValueError('Placement requires an idle owned object')
        if not isinstance(pose,dict) or not pose or set(pose)-{'position','secondaryPosition','basis','direction'}:
            raise ValueError('Unknown or empty parent placement fields')
        if 'basis' in pose and 'direction' in pose:raise ValueError('Placement cannot supply both basis and direction')
        for key,value in pose.items():
            size=16 if key=='basis' else 3
            if not isinstance(value,list) or len(value)!=size or any(type(v) not in [int,float] or not math.isfinite(v) or not math.isfinite(struct.unpack('<f',struct.pack('<f',v))[0]) for v in value):
                raise ValueError('Placement requires finite native float vectors')
        if 'direction' in pose and not sum(struct.unpack('<f',struct.pack('<f',v))[0]**2 for v in pose['direction'])>0:raise ValueError('Placement requires a nonzero direction')
        if 'basis' in pose and [pose['basis'][i] for i in [3,7,11,15]]!=[0,0,0,1]:raise ValueError('Placement requires an affine basis')
        calls=[]
        for key in ['position','secondaryPosition','basis','direction']:
            if key not in pose:continue
            data=struct.pack('<'+'f'*len(pose[key]),*pose[key]);self.u.mem_write(POSE_INPUT,data)
            setter=SETTERS['initialPosition' if initial and key=='position' else key]
            self.call(setter,{r.UC_X86_REG_RDI:obj,r.UC_X86_REG_RSI:POSE_INPUT});calls.append(setter)
        return {'setters':calls,'objectHex':bytes(self.u.mem_read(obj,0x238)).hex()}

    def synchronize_placement(self,obj):
        if obj not in self.object_addresses or self.in_parent_tick:raise ValueError('Placement sync requires an idle owned object')
        parent=self.q(obj+0x28)
        if self.allocations.get(parent)!=0x2c0:raise ValueError('Placement sync requires a live owned parent')
        # EDX=0 requests propagation without object-owned time advancement.
        # The admitted provider-free path does not dereference the frame input.
        if any(self.q(obj+off) for off in [0x170,0x180,0x190]):raise ValueError('Live transform providers require another placement contract')
        if struct.unpack('<f',self.u.mem_read(obj+0x1f0,4))[0]!=0:raise ValueError('Object-owned simulation time requires a real frame input')
        self.in_placement_sync=True
        try:self.call(SYNC,{r.UC_X86_REG_RDI:obj,r.UC_X86_REG_RSI:0,r.UC_X86_REG_RDX:0})
        finally:self.in_placement_sync=False
        return {'objectHex':bytes(self.u.mem_read(obj,0x238)).hex(),'parentHex':bytes(self.u.mem_read(parent,0x2c0)).hex()}
