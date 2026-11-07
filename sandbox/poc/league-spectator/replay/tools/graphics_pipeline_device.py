"""GLES pipeline state from the matching client's 32-byte render descriptor.

GLES has no monolithic pipeline object: an owned pipeline is an already linked
program and a complete state bundle. Creation applies/queries that bundle with
explicit validation-only dynamic inputs. Draws must supply their own inputs.
Native enum tables and selector call sites are retained as provenance.
"""
import ctypes as C
import math
import struct


# Metal enum values are from Apple's metal-cpp headers. Client indices are read
# from this exact executable's tables, rather than assumed to be Metal values.
METAL_COMPARE_GL=(0x0200,0x0201,0x0202,0x0203,0x0204,0x0205,0x0206,0x0207)
METAL_STENCIL_GL=(0x1e00,0,0x1e01,0x1e02,0x1e03,0x150a,0x8507,0x8508)
METAL_BLEND_GL=(0,1,0x0300,0x0301,0x0302,0x0303,0x0306,0x0307,0x0304,0x0305,0x0308,0x8001)
METAL_OPERATION_GL=(0x8006,0x800a,0x800b,0x8007,0x8008)
TABLES={'compare':(0x20edf50,8),'stencil':(0x20edf90,8),
    'operation':(0x20edfd0,5),'blend':(0x20ee000,11),'fill':(0x20ee150,4)}


class GraphicsPipelineDevice:
    def __init__(self,device,image):
        self.device=device;self.gl=device.gl
        self.tables={name:list(struct.unpack_from('<'+'Q'*count,image,at))
            for name,(at,count) in TABLES.items()}
        if self.tables!={'compare':[7,0,1,3,4,6,2,5],'stencil':[0,1,2,3,6,4,7,5],
                'operation':[0,1,2,3,4],'blend':[0,1,2,3,6,7,4,5,8,9,11],'fill':[0,1,0,0]}:
            raise ValueError('Exact-build pipeline enum tables differ')
        u,i,b,f=C.c_uint,C.c_int,C.c_ubyte,C.c_float
        for name,result,args in [
                ('glBlendFuncSeparate',None,[u,u,u,u]),('glBlendEquationSeparate',None,[u,u]),
                ('glBlendColor',None,[f,f,f,f]),('glDepthFunc',None,[u]),('glDepthMask',None,[b]),
                ('glColorMask',None,[b,b,b,b]),('glCullFace',None,[u]),('glFrontFace',None,[u]),
                ('glPolygonOffset',None,[f,f]),('glStencilFuncSeparate',None,[u,u,i,u]),
                ('glStencilOpSeparate',None,[u,u,u,u]),('glStencilMaskSeparate',None,[u,u]),
                ('glGetIntegerv',None,[u,C.POINTER(i)]),('glGetBooleanv',None,[u,C.POINTER(b)]),
                ('glGetFloatv',None,[u,C.POINTER(f)]),('glIsEnabled',b,[u])]:
            device.fn(self.gl,name,result,*args)
        self.records=[]

    def decode(self,raw):
        if not isinstance(raw,bytes) or len(raw)!=32:raise ValueError('Exact native pipeline descriptor required')
        flags,masks=raw[4],raw[16]
        if flags&0xe0 or masks&0xc0 or raw[15]>1 or any(raw[18:24]):
            raise ValueError('Unadmitted native pipeline flags or reserved fields')
        def enum(name,index,mapping):
            table=self.tables[name]
            if index>=len(table) or table[index]>=len(mapping):
                raise ValueError(f'Unadmitted native pipeline enum: {name}/{index}')
            return mapping[table[index]]
        if raw[17]>=len(self.tables['fill']) or self.tables['fill'][raw[17]]!=0:
            raise ValueError('Native wireframe pipeline requires a geometry implementation')
        bias_scale,bias_constant=struct.unpack_from('<ff',raw,24)
        if not all(math.isfinite(v) for v in [bias_scale,bias_constant]):
            raise ValueError('Nonfinite native pipeline bias')
        blend=bool(flags&4);depth=bool(flags&1);stencil=bool(flags&2 or masks&0x20)
        mask=struct.unpack_from('<I',raw)[0]
        state={'blendEnabled':blend,'depthEnabled':depth,'stencilEnabled':stencil,
            'cullEnabled':bool(flags&0x10),'polygonOffsetEnabled':bool(flags&8),
            'colorMask':[bool(masks&(1<<i)) for i in range(4)],'depthMask':bool(depth and masks&0x10),
            'depthFunction':enum('compare',raw[5],METAL_COMPARE_GL) if depth else 0x0207,
            'stencilFunction':enum('compare',raw[6],METAL_COMPARE_GL) if stencil else 0x0207,
            'stencilOperations':[enum('stencil',raw[i],METAL_STENCIL_GL) for i in [7,8,9]] if stencil else [0x1e00]*3,
            'stencilReadMask':mask if stencil else 0xffffffff,
            'stencilWriteMask':mask if stencil and masks&0x20 else 0,
            # Native bytes are source RGB, source alpha, destination RGB,
            # destination alpha. GLES orders RGB before alpha pairs.
            'blendFactors':[enum('blend',raw[i],METAL_BLEND_GL) for i in [10,12,11,13]] if blend else [1,0,1,0],
            'blendOperations':[enum('operation',raw[14],METAL_OPERATION_GL)]*2 if blend else [0x8006]*2,
            'cullFace':0x0405,'frontFace':0x0900 if raw[15] else 0x0901,
            'polygonOffset':[bias_scale,bias_constant] if flags&8 else [0.0,0.0]}
        return state

    def apply(self,record,*,stencil_reference,blend_color):
        if not isinstance(stencil_reference,int) or not 0<=stencil_reference<=255:
            raise ValueError('Explicit bounded draw stencil reference required')
        if len(blend_color)!=4 or not all(type(v) in [int,float] and math.isfinite(v) and 0<=v<=1 for v in blend_color):
            raise ValueError('Explicit finite draw blend color required')
        if self.gl.glGetError():raise ValueError('GLES has an error before pipeline binding')
        s=record['state'];gl=self.gl;gl.glUseProgram(record['glProgram'])
        for capability,key in [(0x0be2,'blendEnabled'),(0x0b71,'depthEnabled'),(0x0b90,'stencilEnabled'),
                (0x0b44,'cullEnabled'),(0x8037,'polygonOffsetEnabled')]:
            (gl.glEnable if s[key] else gl.glDisable)(capability)
        gl.glBlendFuncSeparate(*s['blendFactors']);gl.glBlendEquationSeparate(*s['blendOperations'])
        gl.glBlendColor(*blend_color);gl.glDepthFunc(s['depthFunction']);gl.glDepthMask(s['depthMask'])
        gl.glColorMask(*s['colorMask']);gl.glCullFace(s['cullFace']);gl.glFrontFace(s['frontFace'])
        gl.glPolygonOffset(*s['polygonOffset'])
        for face in [0x0404,0x0405]:
            gl.glStencilFuncSeparate(face,s['stencilFunction'],stencil_reference,s['stencilReadMask'])
            gl.glStencilOpSeparate(face,*s['stencilOperations']);gl.glStencilMaskSeparate(face,s['stencilWriteMask'])
        if gl.glGetError():raise ValueError('Native pipeline GLES state binding failed')

    def inspect(self,record,*,stencil_reference,blend_color):
        s=record['state'];gl=self.gl;observed={}
        for capability,key in [(0x0be2,'blendEnabled'),(0x0b71,'depthEnabled'),(0x0b90,'stencilEnabled'),
                (0x0b44,'cullEnabled'),(0x8037,'polygonOffsetEnabled')]:observed[key]=bool(gl.glIsEnabled(capability))
        def integer(token):
            value=C.c_int();gl.glGetIntegerv(token,C.byref(value));return value.value
        for key,token in [('depthFunction',0x0b74),('cullFace',0x0b45),('frontFace',0x0b46)]:observed[key]=integer(token)
        observed['blendFactors']=[integer(token) for token in [0x80c9,0x80c8,0x80cb,0x80ca]]
        observed['blendOperations']=[integer(token) for token in [0x8009,0x883d]]
        observed['depthMask']=bool(integer(0x0b72));mask=(C.c_ubyte*4)();gl.glGetBooleanv(0x0c23,mask)
        observed['colorMask']=[bool(v) for v in mask]
        observed['polygonOffset']=[]
        for token in [0x8038,0x2a00]:
            value=C.c_float();gl.glGetFloatv(token,C.byref(value));observed['polygonOffset'].append(value.value)
        faces=[]
        for function,fail,depth_fail,passed,ref,read_mask,write_mask in [
                (0x0b92,0x0b94,0x0b95,0x0b96,0x0b97,0x0b93,0x0b98),
                (0x8800,0x8801,0x8802,0x8803,0x8ca3,0x8ca4,0x8ca5)]:
            face={'stencilFunction':integer(function),'stencilOperations':[integer(t) for t in [fail,depth_fail,passed]],
                'stencilReference':integer(ref),'stencilReadMask':integer(read_mask)&0xffffffff,
                'stencilWriteMask':integer(write_mask)&0xffffffff}
            expected={k:s[k] for k in ['stencilFunction','stencilOperations','stencilReadMask','stencilWriteMask']}
            expected['stencilReference']=stencil_reference
            if face!=expected:raise ValueError(f'Native pipeline stencil state differs: {face} / {expected}')
            faces.append(face)
        observed.update({k:faces[0][k] for k in ['stencilFunction','stencilOperations','stencilReadMask','stencilWriteMask']})
        color=(C.c_float*4)();gl.glGetFloatv(0x8005,color)
        if list(color)!=[C.c_float(v).value for v in blend_color] or integer(0x8b8d)!=record['glProgram']:
            raise ValueError('Native pipeline dynamic inputs or program differ')
        if gl.glGetError() or observed!=s:raise ValueError(f'Native pipeline queried state differs: {observed} / {s}')
        return {'state':observed,'stencilFaces':faces,'blendColor':list(color),'glProgram':record['glProgram']}

    def create(self,raw,program):
        if not program.get('linked') or not program.get('glHandle'):
            raise ValueError('Native pipeline requires an actual linked GLES program')
        record={'descriptorHex':raw.hex(),'glProgram':program['glHandle'],'state':self.decode(raw),
            'created':False,'pipelineIsStateBundle':True}
        validation={'stencil_reference':3,'blend_color':[0.125,0.25,0.5,0.75]}
        self.apply(record,**validation);record['validation']=self.inspect(record,**validation)
        record['created']=True;self.records.append(record)
        return record
