"""Resolve native shader requests against exact-build translated TOCs.

The original request supplies a path and full define set. Only defines declared
by that stage participate in its permutation key, as in the prepared TOC proof.
Actual GLES compilation/linking must succeed before a resource is returned.
"""
import ctypes as C
import hashlib
import json
from pathlib import Path
from shader_permutation import select_permutation


def sha(data):
    return hashlib.sha256(data).hexdigest()


class GraphicsShaderCatalog:
    def __init__(self, directory, device):
        self.directory=directory
        self.device=device
        raw=(directory/'package.json').read_bytes()
        self.manifest=json.loads(raw)
        if (self.manifest['schema']!=1 or
                self.manifest['kind']!='installed-particle-shader-translations' or
                self.manifest['build']!='16.21.829.8620' or
                self.manifest['compiler']['pipelineVersion']!=4):
            raise ValueError('Unadmitted native graphics shader package')
        self.inputs={str(directory/'package.json'):sha(raw)}
        selector=Path(__file__).with_name('shader_permutation.py')
        self.inputs[str(selector.resolve())]=sha(selector.read_bytes())
        self.shaders={};self.programs={};self.requests=[]

    def create_shader(self, path, stage, defines):
        if stage not in ['vertex','pixel'] or len(defines)>32:
            raise ValueError('Unadmitted shader stage/define count')
        matches=[s for s in self.manifest['stages'] if s['file']==path.lower() and s['stage']==stage]
        if len(matches)!=1:raise ValueError(f'Unprepared native shader path: {stage}/{path}')
        source=matches[0]
        selected=select_permutation(source,defines)
        if selected['id'] is None:
            raise ValueError('Unprepared native shader permutation: '+selected['hash'])
        records=[v for v in source['records'] if v['id']==selected['id']]
        if len(records)!=1:raise ValueError('Ambiguous native shader TOC record')
        translations=[v for v in self.manifest['translations']
            if v['stage']==stage and v['dxbcSha256']==records[0]['dxbcSha256']]
        if len(translations)!=1:raise ValueError('Unprepared native shader translation')
        ref=translations[0];file=self.directory/ref['file'];raw=file.read_bytes()
        if sha(raw)!=ref['sha256']:raise ValueError('Native graphics shader translation changed')
        self.inputs[str(file)]=sha(raw);translation=json.loads(raw)
        handle,success,log=self.device.compile(translation['glsl'],stage)
        if not success:
            self.device.gl.glDeleteShader(handle)
            raise ValueError(f'Native graphics shader compilation failed: {log}')
        record={'path':path,'stage':stage,'defines':defines,
            'permutationDefines':selected['defines'],
            'permutationHash':selected['hash'],'recordId':records[0]['id'],'translation':ref,
            'glHandle':handle,'compiled':True,'log':log}
        self.shaders[handle]={'record':record,'translation':translation}
        self.requests.append(record)
        return record

    def create_program(self, vertex, pixel):
        v,p=self.shaders.get(vertex),self.shaders.get(pixel)
        if not v or not p or v['record']['stage']!='vertex' or p['record']['stage']!='pixel':
            raise ValueError('Unowned native graphics program stages')
        gl=self.device.gl;handle=gl.glCreateProgram()
        gl.glAttachShader(handle,vertex);gl.glAttachShader(handle,pixel);gl.glLinkProgram(handle)
        status=C.c_int();gl.glGetProgramiv(handle,0x8b82,C.byref(status))
        log=self.device.log(handle,True)
        if not status.value:
            gl.glDeleteProgram(handle)
            raise ValueError(f'Native graphics program link failed: {log}')
        record={'glHandle':handle,'vertex':vertex,'pixel':pixel,'linked':True,'log':log}
        self.programs[handle]=record
        return record

    def close(self):
        for handle in self.programs:self.device.gl.glDeleteProgram(handle)
        for handle in self.shaders:self.device.gl.glDeleteShader(handle)
        self.programs.clear();self.shaders.clear()
