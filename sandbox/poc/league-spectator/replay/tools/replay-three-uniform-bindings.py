"""Replay exact source-executed UBO commands onto real ANGLE buffers and pixels.

The vertex shader/triangle comes from the owned nav producer. A diagnostic
fragment shader exposes every byte of every active UBO through RGBA8 pixels.
These are buffer-resource tests, not League/world/browser pixel parity.
"""
import argparse
import ctypes as C
import itertools
import importlib.util
import json
import struct
import sys
from pathlib import Path
from navmesh_resource_coordinates import adapt_navmesh_resource_vertex

module_path=Path(__file__).with_name('render-particle-shader.py')
spec=importlib.util.spec_from_file_location('ubo_pixel_angle',module_path)
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)


def fragment(program):
    declarations=[];select=[];first=0
    for index,block in enumerate(program['blocks']):
        name,size=block['name'],block['size']
        if not name.replace('_','').isalnum() or name[0].isdigit() or size<=0 or size%16:
            raise ValueError('Bounded std140 uvec4 fixture layout required')
        vectors=size//16
        declarations.append(f'layout(std140) uniform {name} {{ uvec4 m[{vectors}]; }} block_{index};')
        select.append(('if' if index==0 else 'else if')+f' (vectorIndex < {first+vectors}) value = block_{index}.m[vectorIndex - {first}];')
        first+=vectors
    return ('#version 300 es\nprecision highp float;\nprecision highp int;\n'+ '\n'.join(declarations)+
        '\nlayout(location=0) out vec4 SV_Target;\nvoid main() {\nint pixel=int(gl_FragCoord.x);\n'+
        'int vectorIndex=pixel/4; uint shift=uint(pixel%4)*8u; uvec4 value=uvec4(0u);\n'+
        '\n'.join(select)+'\nSV_Target=vec4((value >> shift) & uvec4(255u))/255.0;\n}\n')


def expected_pixels(blocks):
    data=b''.join(bytes.fromhex(block['bytesHex']) for block in blocks)
    result=bytearray()
    for at in range(0,len(data),16):
        vector=data[at:at+16]
        for byte in range(4):result.extend(vector[lane*4+byte] for lane in range(4))
    return bytes(result)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('angle',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=adapter.sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Uniform replay input changed: '+str(path))
        inputs[str(path)]=digest;return data
    def read(path):return json.loads(raw(path))
    proof=read(cache/'research/direct-three-uniform-bindings-v33.json')
    if proof['mismatches'] or proof['policy']!='program-block-bindings-and-raw-samplers-v2':
        raise ValueError('Passing exact-source bounded uniform manager control required')
    for path,digest in proof['inputs'].items():
        if adapter.sha(raw(path))!=digest:raise ValueError('Uniform source-host input changed: '+path)
    commands=read(proof['commandPath'])
    if commands['policy']!=proof['policy']:raise ValueError('Exact combined vendor adapter policy required')
    if inputs[str(Path(proof['commandPath']).resolve())]!=proof['commandSha256']:
        raise ValueError('Source-executed GL command digest differs')
    if commands['hostLimits']['maxBindings']!=2:raise ValueError('Expected bounded two-slot source host stress')
    source_vertex=read(cache/'public/latest-shared-shaders-navmask-v29/stages/ea6fba36ce6d661beb55e8b2aa4856753a04bb6a8862b022387d7a027288b22a.json')
    source_vertex['glsl']=adapt_navmesh_resource_vertex(source_vertex['glsl'])
    used_programs={command['program'] for command in commands['commands'] if command['op']=='draw'}
    programs=[p for p in commands['programs'] if p['id'] in used_programs]
    shaders={p['id']:fragment(p) for p in programs}
    programs_by_id={p['id']:p for p in programs}
    observations=[];contexts=[];op_counts={};draws=0;peak_buffers=0
    for context_id,sequence in itertools.groupby(commands['commands'],key=lambda c:c['context']):
        d=adapter.Draw(args.angle);buffers={};live=set();compiled={};indices={}
        try:
            for name,result,types in [
                ('glGetIntegerv',None,[C.c_uint,C.POINTER(C.c_int)]),
                ('glGetIntegeri_v',None,[C.c_uint,C.c_uint,C.POINTER(C.c_int)]),
                ('glGetActiveUniformBlockiv',None,[C.c_uint,C.c_uint,C.c_uint,C.POINTER(C.c_int)]),
                ('glBufferSubData',None,[C.c_uint,C.c_ssize_t,C.c_ssize_t,C.c_void_p]),
                ('glDrawArrays',None,[C.c_uint,C.c_int,C.c_int])]:d.fn(d.gl,name,result,*types)
            capacity=C.c_int();d.gl.glGetIntegerv(0x8a2f,C.byref(capacity))
            if capacity.value<commands['hostLimits']['maxBindings']:raise ValueError('Native binding capacity below stress host')
            for program in programs:
                identifier=program['id'];handle=d.program(source_vertex,{'glsl':shaders[identifier]})
                compiled[identifier]=handle;indices[identifier]={}
                count=C.c_int();d.gl.glGetProgramiv(handle,0x8a36,C.byref(count))
                if count.value!=len(program['blocks']):raise ValueError('Native diagnostic active block count differs')
                for logical,block in enumerate(program['blocks']):
                    native=d.gl.glGetUniformBlockIndex(handle,block['name'].encode())
                    size=C.c_int();d.gl.glGetActiveUniformBlockiv(handle,native,0x8a40,C.byref(size))
                    if native==0xffffffff or size.value!=block['size']:raise ValueError('Native diagnostic std140 block reflection differs')
                    indices[identifier][logical]=native
            vertex=d.buffer(0x8892,struct.pack('<6f',0,0,2,0,0,2))
            d.gl.glEnableVertexAttribArray(0);d.gl.glVertexAttribPointer(0,2,0x1406,False,8,None)
            for flag in [0xbe2,0xb44,0xb71,0xb90,0x8037,0xbd0]:d.gl.glDisable(flag)
            d.gl.glColorMask(True,True,True,True)
            count=0
            for command in sequence:
                op=command['op'];op_counts[op]=op_counts.get(op,0)+1
                identifier=command.get('buffer')
                if op=='createBuffer':
                    if identifier in buffers:raise ValueError('Opaque buffer identity reused')
                    handle=C.c_uint();d.gl.glGenBuffers(1,C.byref(handle));buffers[identifier]=handle;live.add(identifier)
                    peak_buffers=max(peak_buffers,len(live))
                elif op=='bufferData':
                    if identifier not in live:raise ValueError('Allocation on retired buffer')
                    d.gl.glBindBuffer(0x8a11,buffers[identifier]);d.gl.glBufferData(0x8a11,command['size'],None,command['usage'])
                elif op=='bufferSubData':
                    if identifier not in live:raise ValueError('Upload on retired buffer')
                    data=bytes.fromhex(command['bytesHex']);d.gl.glBindBuffer(0x8a11,buffers[identifier])
                    d.gl.glBufferSubData(0x8a11,command['offset'],len(data),C.create_string_buffer(data))
                elif op=='uniformBlockBinding':
                    program=command['program'];d.gl.glUniformBlockBinding(compiled[program],indices[program][command['index']],command['slot'])
                elif op=='bindBufferBase':
                    if identifier not in live:raise ValueError('Binding a retired buffer')
                    if not 0<=command['slot']<commands['hostLimits']['maxBindings']:raise ValueError('Source manager escaped its two-slot limit')
                    d.gl.glBindBufferBase(0x8a11,command['slot'],buffers[identifier])
                elif op=='deleteBuffer':
                    if identifier not in live:raise ValueError('Buffer deleted twice')
                    d.gl.glDeleteBuffers(1,C.byref(buffers[identifier]));live.remove(identifier)
                elif op=='draw':
                    program=command['program'];ordered=programs_by_id[program]['blocks']
                    if [b['name'] for b in command['blocks']]!=[b['name'] for b in ordered]:raise ValueError('Draw resource order differs')
                    for block in command['blocks']:
                        bound=C.c_int();d.gl.glGetIntegeri_v(0x8a28,block['slot'],C.byref(bound))
                        if bound.value!=buffers[block['buffer']].value:raise ValueError('Actual native slot buffer differs from source checkpoint')
                        binding=C.c_int();d.gl.glGetActiveUniformBlockiv(compiled[program],indices[program][block['index']],0x8a3f,C.byref(binding))
                        if binding.value!=block['slot']:raise ValueError('Native program-to-binding mapping differs')
                    expected=expected_pixels(command['blocks']);width=len(expected)//4
                    d.gl.glUseProgram(compiled[program]);d.gl.glViewport(0,0,width,1);d.gl.glDrawArrays(4,0,3)
                    pixels=C.create_string_buffer(len(expected));d.gl.glReadPixels(0,0,width,1,0x1908,0x1401,pixels)
                    if pixels.raw!=expected:
                        raise ValueError('Native exact UBO byte pixels differ: '+command['label']+' actual='+pixels.raw.hex()+' expected='+expected.hex())
                    observations.append({'context':context_id,'program':program,'label':command['label'],'rgbaBytes':len(expected),
                        'rgbaSha256':adapter.sha(pixels.raw),'expectedRgbaSha256':adapter.sha(expected)})
                    draws+=1;count+=1
                else:raise ValueError('Unknown exported GL command: '+op)
                error=d.gl.glGetError()
                if error:raise ValueError(f'Native exported {op} GL error {error:x}')
            if live:raise ValueError('Source disposal left live native buffers')
            contexts.append({'id':context_id,'native':d.info,'maxUniformBufferBindings':capacity.value,'draws':count,
                'createdBuffers':len(buffers),'allDeleted':True})
        finally:
            for handle in compiled.values():d.gl.glDeleteProgram(handle)
            d.close()
    if peak_buffers<=24 or len(contexts)!=2 or draws!=443:raise ValueError('Complete oversubscription/context-recreate source cohort required')
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):raw(path)
    for path in [Path(__file__),module_path,args.angle/'libEGL.dll',args.angle/'libGLESv2.dll']:raw(path)
    for path,digest in inputs.items():
        if adapter.sha(Path(path).read_bytes())!=digest:raise ValueError('Uniform pixel replay input changed: '+path)
    output=cache/'research/direct-three-uniform-bindings-gles-v33.json'
    output.write_text(json.dumps({'schema':1,'kind':'actual-gles-source-executed-uniform-command-replay','inputs':inputs,
        'contexts':contexts,'commands':op_counts,'programs':[dict(p,fragmentShader=shaders[p['id']]) for p in programs],
        'draws':observations,'peakSimultaneouslyLiveGroupBuffers':peak_buffers,'mismatches':0,
        'scope':{'actualNativeGlBuffersAndBindings':True,'actualRgba8Readback':True,'allUboBytesExposedInPixels':True,
            'opaqueNativeBlockIndicesResolvedByName':True,'omittedBindBufferRestoredFromRecordedBufferIdentity':True,
            'originalNavVertexShaderAndTriangle':True,'diagnosticFragmentShader':True,'leaguePixelParity':False,
            'browserContextObserved':False,'nativeWorldAcceptance':False}},indent=2))
    print(json.dumps({'output':str(output),'contexts':len(contexts),'draws':draws,'commands':sum(op_counts.values()),'peakGroupBuffers':peak_buffers,'mismatches':0}))


if __name__=='__main__':main()
