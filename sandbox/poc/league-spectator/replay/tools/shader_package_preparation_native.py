"""Prepare missing static shader stages at a suspended owned backend request."""
import json
import re
import subprocess
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import sha


def shader_preparation_config(fixture,installation,compiler,bun):
    config={name:str(Path(value).resolve()) for name,value in
            [('installation',installation),('compiler',compiler),('bun',bun)]}
    for path in [Path(config['bun']),fixture.root/'tools/prepare-shared-graphics-shaders.mjs',
                 fixture.root/'tools/wad.mjs',Path(config['compiler'])/'sources.json',
                 Path(config['compiler'])/'Cargo.toml',Path(config['compiler'])/'Cargo.lock',
                 Path(config['compiler'])/'target/release/scout-shader-prepare.exe']:
        fixture.raw(path)
    return {**config,'maximumNewStages':32,
            'preparerSha256':sha(fixture.raw(fixture.root/'tools/prepare-shared-graphics-shaders.mjs'))}


def prepare_native_shader_path(fixture,catalog,config,path,stage,batches):
    if (stage not in ['vertex','pixel'] or
            not re.fullmatch(r'assets/shaders/(hlsl|generated/shaders)/[a-z0-9_/-]+\.(vs|ps)',path.lower()) or
            not path.lower().endswith('.vs' if stage=='vertex' else '.ps')):
        raise ValueError('Only exact native-requested shader stage paths are admitted')
    if any(s['file']==path.lower() and s['stage']==stage for s in catalog.manifest['stages']):
        raise ValueError('Static shader preparation requires a missing stage, not a replacement permutation')
    current=Path(catalog.directory).resolve();public=(fixture.cache/'public').resolve()
    if (current.parent!=public or not re.fullmatch(r'latest-shared-shaders(-[a-z0-9-]+)?',current.name) or
            len(batches)>=config['maximumNewStages']):
        raise ValueError('Shader preparation source/count exceeds the isolated package contract')
    old_bytes=fixture.raw(current/'package.json');old=json.loads(old_bytes)
    if old!=catalog.manifest:raise ValueError('Active shader package changed before static preparation')
    if sha(fixture.raw(fixture.root/'tools/prepare-shared-graphics-shaders.mjs'))!=config['preparerSha256']:
        raise ValueError('Configured static shader preparer changed during the native control')
    suffix=sha(old_bytes+f'{stage}/{path.lower()}'.encode()+config['preparerSha256'].encode())[:6]
    target_name=f'latest-shared-shaders-p{len(batches)+1}-{suffix}'
    target=public/target_name
    if target==current:raise ValueError('Static shader preparation must retain its active package')
    record={'stage':stage,'path':path,'fromPackage':str(current),'toPackage':str(target),
            'fromPackageSha256':sha(old_bytes),'completed':False};batches.append(record)
    print(json.dumps({'phase':'prepare-missing-static-shader','stage':stage,'path':path,'output':target_name}),flush=True)
    command=[config['bun'],str(fixture.root/'tools/prepare-shared-graphics-shaders.mjs'),
             config['installation'],str(fixture.cache),config['compiler'],'--output-name',target_name,
             '--seed-name',current.name,path]
    result=subprocess.run(command,capture_output=True,text=True,encoding='utf-8',timeout=1800,
                          creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    record.update(compilerExitCode=result.returncode,stdoutSha256=sha(result.stdout.encode()),
                  stderrSha256=sha(result.stderr.encode()))
    if result.returncode:
        raise ValueError('Static shader preparation failed: '+result.stderr[-3000:]+result.stdout[-1000:])
    new_bytes=fixture.raw(target/'package.json');new=json.loads(new_bytes)
    for key in ['schema','kind','build','executableSha256','archive','archiveSha256','compiler']:
        if new[key]!=old[key]:raise ValueError('Static shader extension changed its build/compiler contract')
    for field,key in [('stages',lambda row:(row['stage'],row['file'])),
                      ('translations',lambda row:(row['stage'],row['dxbcSha256'])),
                      ('bundles',lambda row:row['path'])]:
        index={key(row):row for row in new[field]}
        if len(index)!=len(new[field]) or any(index.get(key(row))!=row for row in old[field]):
            raise ValueError('Static shader extension removed or changed an active '+field+' entry')
    selected=[s for s in new['stages'] if s['file']==path.lower() and s['stage']==stage]
    if len(selected)!=1:raise ValueError('Static shader extension omitted its exact requested stage')
    # Keep all existing GL shader/program handles and their original inputs.
    # Only the verified append-only lookup package changes; old directories
    # remain immutable and stay in the input fingerprint set.
    catalog.directory=target;catalog.manifest=new;catalog.inputs[str(target/'package.json')]=sha(new_bytes)
    record.update(completed=True,toPackageSha256=sha(new_bytes),stageRecords=len(selected[0]['records']),
                  stagePermutations=len(selected[0]['permutations']))
    print(json.dumps({'phase':'prepared-static-shader','stage':stage,'path':path,
                      'records':record['stageRecords'],'permutations':record['stagePermutations']}),flush=True)
    return record


class NativeShaderPackagePreparation:
    def __init__(self,*args,**kwargs):
        self.shader_preparation_config=None;self.shader_preparation_batches=[];self.shader_preparation_fixture=None
        super().__init__(*args,**kwargs)

    def configure_shader_preparation(self,fixture,installation,compiler,bun):
        if self.shader_preparation_config is not None:raise ValueError('Native shader preparation is already configured')
        self.shader_preparation_fixture=fixture
        self.shader_preparation_config=shader_preparation_config(fixture,installation,compiler,bun)
        return dict(self.shader_preparation_config)

    def shader_call(self,kind):
        if self.shader_preparation_config and kind in ['vertex','pixel']:
            if self.shader_catalog is None:raise ValueError('Original shader catalog is required for static preparation')
            descriptor=self.u.reg_read(r.UC_X86_REG_RDX)
            if not self.library_pointer(descriptor,0x28):raise ValueError('Native shader descriptor exceeds owned bounds')
            pointer,length=self.q(descriptor+0x18),self.u32(descriptor+0x20)
            if not 0<length<4096 or not self.library_pointer(pointer,length):
                raise ValueError('Native shader path exceeds owned bounds')
            path=bytes(self.u.mem_read(pointer,length)).decode('ascii')
            matches=[s for s in self.shader_catalog.manifest['stages'] if s['file']==path.lower() and s['stage']==kind]
            if not matches:
                prepare_native_shader_path(self.shader_preparation_fixture,self.shader_catalog,
                                           self.shader_preparation_config,path,kind,self.shader_preparation_batches)
        return super().shader_call(kind)
