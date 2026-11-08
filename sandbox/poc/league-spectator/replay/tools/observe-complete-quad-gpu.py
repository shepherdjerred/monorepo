"""Compile/link every selected complete-quad GPU program offscreen."""
import argparse,importlib.util,json
from pathlib import Path
from vfx_spawn_native import sha

spec=importlib.util.spec_from_file_location('quad_draw',Path(__file__).with_name('render-particle-shader.py'))
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','angle']:p.add_argument(name,type=Path)
    a=p.parse_args();cache=a.cache.resolve();path=cache/'public/latest-complete-quad-gpu/package.json'
    raw=path.read_bytes();gpu=json.loads(raw)
    for name,h in gpu['inputs'].items():
        if sha(Path(name).read_bytes())!=h:raise ValueError('Complete quad GPU input changed: '+name)
    renderer=adapter.Draw(a.angle);programs={};stages=set()
    try:
        for e in gpu['emitters']:
            key=tuple(e['shaders'][s]['sha256'] for s in ['vertex','pixel'])
            if key in programs:continue
            compiled=[]
            for s in ['vertex','pixel']:
                ref=e['shaders'][s];b=(cache/'public/latest-shaders'/ref['file']).read_bytes()
                if sha(b)!=ref['sha256']:raise ValueError('Complete quad shader changed')
                compiled.append(json.loads(b));stages.add(ref['sha256'])
            program=renderer.program(*compiled);renderer.gl.glDeleteProgram(program)
            programs[key]={'effectId':e['effectId'],'emitterIndex':e['emitterIndex'],'shaders':e['shaders']}
    finally:renderer.close()
    result={'schema':1,'kind':'complete-quad-program-observation','packageSha256':sha(raw),
        'observerSha256':sha(Path(__file__).read_bytes()),'context':renderer.info,
        'adapterSha256':sha(Path(__file__).with_name('render-particle-shader.py').read_bytes()),
        'programs':list(programs.values()),'counts':{'emitterBindings':len(gpu['emitters']),
            'uniquePrograms':len(programs),'shaderStages':len(stages),'compileFailures':0,'linkFailures':0},
        'scope':{'offscreenCompiledAndLinked':True,'gpuDrawsSubmitted':False,
            'browserRun':False,'sceneResourcesBound':False,'referenceCompared':False}}
    (cache/'research/complete-quad-gpu-observation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result['counts']))


if __name__=='__main__':main()
