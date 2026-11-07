"""Bound expanded static-material macros before TOC filtering.

The existing VFX API retains its 32-entry bound. Static material requests may
have more raw macros, but the DX11 selector already ignores undeclared hashes.
All raw entries are validated, retained in evidence, and only that proven
filter is applied before calling the unchanged selector/GLES provider.
"""
from unicorn import x86_const as r
from shader_permutation import macro_hash

MATERIAL_RAW_MACRO_BUDGET = 256  # Platform input budget, not a claimed game limit.


def declared_macro_indices(source, raw):
    if not isinstance(raw,list) or not 32 < len(raw) <= MATERIAL_RAW_MACRO_BUDGET:
        raise ValueError('Observed bounded expanded material macro vector required')
    names=set();hashes=[]
    for row in raw:
        if not isinstance(row,dict) or set(row) != {'name','value'}:
            raise ValueError('Typed material macro name/value required')
        name,value=row['name'],row['value']
        if not isinstance(name,str) or not isinstance(value,str) or len(name)>4095 or len(value)>4095:
            raise ValueError('Bounded native material macro strings required')
        identity=macro_hash(name,value)
        if name in names: raise ValueError('Duplicate native material shader define')
        names.add(name);hashes.append(identity)
    declared=set()
    for row in source['baseDefines']:
        if macro_hash(row['name'],row['value']) != row['hash']:
            raise ValueError('Static shader declaration hash differs')
        declared.add(row['hash'])
    indices=[index for index,identity in enumerate(hashes) if identity in declared]
    if len(indices)>32:raise ValueError('Declared material macro subset exceeds existing selector bound')
    return indices


class NativeMaterialShaderDefines:
    def __init__(self,*args,**kwargs):
        self.expanded_material_shader_request=None
        self.expanded_material_shader_inputs=[]
        super().__init__(*args,**kwargs)

    def shader_call(self,kind):
        if kind not in ['vertex','pixel']:
            return super().shader_call(kind)
        defines=self.u.reg_read(r.UC_X86_REG_RCX)
        if not self.library_pointer(defines,16) or self.u32(defines+8)<=32:
            return super().shader_call(kind)
        expected={'vertex':0x17dcf3f,'pixel':0x17dd1bf}[kind]
        stack=self.u.reg_read(r.UC_X86_REG_RSP)
        if self.expanded_material_shader_request is not None or self.q(stack)!=self.base+expected:
            raise ValueError('Expanded macros require the original static material callsite')
        descriptor=self.u.reg_read(r.UC_X86_REG_RDX)
        if not self.library_pointer(descriptor,0x28):
            raise ValueError('Owned static material shader descriptor required')
        path,length=self.q(descriptor+0x18),self.u32(descriptor+0x20)
        if not 0<length<4096 or not self.library_pointer(path,length):
            raise ValueError('Finite original material shader path required')
        self.expanded_material_shader_request={'kind':kind,'defines':defines,
            'path':bytes(self.u.mem_read(path,length)).decode('ascii'),'returnRva':expected}
        try:return super().shader_call(kind)
        finally:self.expanded_material_shader_request=None

    def vector(self,address,stride,maximum=16):
        request=self.expanded_material_shader_request
        if not request or address!=request['defines'] or stride!=24 or maximum!=32:
            return super().vector(address,stride,maximum)
        rows=super().vector(address,stride,MATERIAL_RAW_MACRO_BUDGET)
        raw=[{'name':self.cstring(self.q(row)).decode('ascii'),
              'value':self.cstring(self.q(row+8)).decode('ascii')} for row in rows]
        stages=[source for source in self.shader_catalog.manifest['stages']
                if source['stage']==request['kind'] and source['file']==request['path'].lower()]
        if len(stages)!=1:raise ValueError('Prepared original material shader stage required')
        indices=declared_macro_indices(stages[0],raw)
        self.expanded_material_shader_inputs.append({**request,'rawDefines':raw,
                                                     'selectedIndices':indices})
        return [rows[index] for index in indices]
