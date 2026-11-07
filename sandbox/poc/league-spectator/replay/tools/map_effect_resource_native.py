"""Original map merging and complete global lookup over supplied map stacks.

Map values remain serialized reference tokens. This never pretends a token is a
loaded VFX definition, and does not infer a match's active map/guest/overlays.
"""
from unicorn import x86_const as r
from effect_resolver_native import NativeEffectResolverAssets
from unit_resource_native import NativeUnitResources

VECTORS, SELECTED = 0x100e9000, 0x100eb000


class NativeMapEffectResources(NativeEffectResolverAssets):
    create_unit = NativeUnitResources.create_unit

    def __init__(self, *args):
        super().__init__(*args)
        self.unit_resources = {}

    def map_rows(self, obj):
        count, table = self.u32(obj+0x10), self.q(obj+8)
        if count > 65536 or count and not self.library_pointer(table,count*16):
            raise ValueError('Merged resource map exceeds owned memory')
        return [{'key':self.u32(table+i*16),'value':self.q(table+i*16+8)} for i in range(count)]

    def merge_maps(self, objects, registered=False):
        obj = self.allocate(24,0xa5)
        self.call(0x1665840 if registered else 0x16659b0,{r.UC_X86_REG_RDI:obj})
        expected = []
        for source in objects:
            expected.extend(self.map_rows(source))
            self.call(0x16154a0,{r.UC_X86_REG_RDI:obj,r.UC_X86_REG_RSI:source})
        rows = self.map_rows(obj)
        if rows != sorted(expected,key=lambda row:row['key']):
            raise ValueError('Original resource merge differs from stable unsigned key ordering')
        return {'object':obj,'objectHex':bytes(self.u.mem_read(obj,24)).hex(),
            'mapAddress':self.q(obj+8),'rows':rows,
            'mapHex':bytes(self.u.mem_read(self.q(obj+8),len(rows)*16)).hex() if rows else ''}

    def supply_globals(self, first, second, registered):
        # The engine globals hold ResourceResolverComponent pointers, not units.
        components = []
        for index, supplied in enumerate([first,second]):
            if supplied is None:
                component = 0
            else:
                unit = self.create_unit(supplied['base'],supplied['overlays'])
                component = unit['group']
            self.call(0x3783b0,{r.UC_X86_REG_RDI:index,r.UC_X86_REG_RSI:component})
            if self.q(self.base+0x24a8560+index*8) != component:
                raise ValueError('Original global resource component publication differs')
            components.append(component)
        if self.u32(self.base+0x2532bc0):
            raise ValueError('Global resource registration list is not empty')
        registered_objects = []
        for source in registered:
            copied = self.merge_maps([source],True)
            self.call(0x1615ae0,{r.UC_X86_REG_RDI:copied['object']})
            registered_objects.append(copied['object'])
        count, array = self.u32(self.base+0x2532bc0),self.q(self.base+0x2532bb8)
        if count != len(registered_objects) or [self.q(array+i*8) for i in range(count)] != registered_objects:
            raise ValueError('Original registered global map order differs')
        return {'components':components,'registered':registered_objects}

    def resolve_globals(self,key):
        self.u.mem_write(VECTORS,bytes(0x40))
        self.put(SELECTED,'Q',0)
        self.call(0x377890,{r.UC_X86_REG_RDI:key,r.UC_X86_REG_RSI:VECTORS,
            r.UC_X86_REG_RDX:VECTORS+0x20,r.UC_X86_REG_RCX:0,r.UC_X86_REG_R8:SELECTED})
        return {'value':self.u.reg_read(r.UC_X86_REG_RAX),'selectedResolver':self.q(SELECTED)}

    def release_globals(self,world):
        for obj in world['registered']:
            self.call(0x16159a0,{r.UC_X86_REG_RDI:obj})
        for index in range(2):
            self.call(0x3783b0,{r.UC_X86_REG_RDI:index,r.UC_X86_REG_RSI:0})
        if self.u32(self.base+0x2532bc0) or any(self.q(self.base+0x24a8560+index*8) for index in range(2)):
            raise ValueError('Original global resolver cleanup retained a map/component')
