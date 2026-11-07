"""Bind native SCB vertex fields to reflected GLES shader attributes.

This supplies vertex inputs only. It does not provide scene/material constants,
select a mesh's material, submit a game draw, or reconstruct instance buffers.
"""
import ctypes as C


def bind_scb_attributes(device,layout,buffers,program,attributes):
    descriptor=bytes.fromhex(layout['nativeDescriptorHex'])
    expected=bytes.fromhex('0000030001000000020003000100000003010400010000000800020001000000')
    if descriptor!=expected:raise ValueError('Unadmitted native SCB vertex descriptor')
    bindings={b['semantic']:b for b in layout['bindings']}
    if len(bindings)!=4 or set(bindings)!={0,2,3,8}:raise ValueError('Incomplete original SCB vertex bindings')
    semantics={'POSITION':(0,3,0x1406,0),'NORMAL':(2,3,0x1406,0),
        'COLOR':(3,4,0x1401,1),'TEXCOORD':(8,2,0x1406,0)}
    gl=device.gl
    device.fn(gl,'glGetVertexAttribiv',None,C.c_uint,C.c_uint,C.POINTER(C.c_int))
    device.fn(gl,'glGetVertexAttribPointerv',None,C.c_uint,C.c_uint,C.POINTER(C.c_void_p))
    if gl.glGetError():raise ValueError('GPU error before SCB vertex attribute binding')
    records=[];locations=set()
    for attribute in attributes:
        key=attribute['semantic']
        if key not in semantics or attribute['index']!=0:raise ValueError(f'Unprovided SCB vertex semantic: {key}/{attribute["index"]}')
        semantic,components,kind,normalized=semantics[key];binding=bindings[semantic]
        buffer=buffers[binding['nativeBuffer']]
        if (attribute['mask']!=(1<<components)-1 or binding['stride']!=36 or
                binding['offset']+components*(1 if kind==0x1401 else 4)>binding['stride']):
            raise ValueError('SCB vertex field differs from translated shader input width')
        location=gl.glGetAttribLocation(program,attribute['glslName'].encode())
        if location<0 or location in locations:raise ValueError('Reflected SCB vertex attribute is absent or aliased')
        locations.add(location);gl.glBindBuffer(0x8892,buffer['glHandle'])
        gl.glEnableVertexAttribArray(location)
        gl.glVertexAttribPointer(location,components,kind,normalized,binding['stride'],C.c_void_p(binding['offset']))
        expected_state={0x8622:1,0x8623:components,0x8624:binding['stride'],0x8625:kind,
            0x886a:normalized,0x889f:buffer['glHandle']}
        actual={}
        for token,value in expected_state.items():
            result=C.c_int();gl.glGetVertexAttribiv(location,token,C.byref(result));actual[str(token)]=result.value
            if result.value!=value:raise ValueError('Queried GPU vertex attribute differs from original SCB binding')
        pointer=C.c_void_p();gl.glGetVertexAttribPointerv(location,0x8645,C.byref(pointer))
        if (pointer.value or 0)!=binding['offset']:raise ValueError('Queried SCB GPU attribute offset differs')
        records.append({'semantic':key,'location':location,'state':actual,'offset':binding['offset'],
            'nativeBuffer':binding['nativeBuffer']})
    if gl.glGetError():raise ValueError('SCB GPU vertex attribute binding failed')
    return records
