"""Compile/link every uniquely resolved native attached material selection offscreen.

Unresolved selections remain explicit in the comparison input. No browser, desktop
or League process is started, and successful linking does not prove bindings.
"""
import argparse, importlib.util, json
from pathlib import Path
spec=importlib.util.spec_from_file_location('angle',Path(__file__).with_name('observe-shader-angle.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','angle']:p.add_argument(name,type=Path)
    a=p.parse_args();cache=a.cache.resolve();inputs={}
    def raw(path):
        b=path.read_bytes();inputs[str(path.resolve())]=module.sha(b);return b
    proof_path=cache/'research/attached-materials-comparison.json';proof=json.loads(raw(proof_path))
    if proof['counts']['descriptions']!=9231 or not proof['scope']['browserCompatibleAdapterCompared']:raise ValueError('Incomplete attached material comparison')
    angle=module.Angle(a.angle);stages={};programs=[]
    try:
        for entry in proof['selectedPrograms']:
            keys=[]
            for kind in ['vertex','pixel']:
                ref=entry[kind];key=(kind,ref['dxbcSha256']);keys.append(key)
                if key not in stages:
                    b=raw(cache/'public'/entry['package']/ref['file']);dxbc=raw(cache/'public'/entry['package']/ref['dxbc'])
                    if module.sha(b)!=ref['sha256'] or module.sha(dxbc)!=ref['dxbcSha256']:raise ValueError('Selected attached shader changed')
                    handle,success,log=angle.compile(json.loads(b)['glsl'],kind)
                    stages[key]={'handle':handle,'success':success,'log':log,'sha256':ref['sha256']}
            if all(stages[k]['success']for k in keys):success,log=angle.link(*(stages[k]['handle']for k in keys))
            else:success,log=False,'Shader stage compilation failed'
            programs.append({'package':entry['package'],'index':entry['index'],'family':entry['family'],'success':success,'log':log})
        error=angle.gl.glGetError()
        if error:raise ValueError(f'GL error {error:04x}')
    finally:
        for stage in stages.values():angle.gl.glDeleteShader(stage['handle'])
        angle.close()
    result={'schema':1,'kind':'offscreen-attached-material-program-observation',
        'comparisonSha256':inputs[str(proof_path)],'observerSha256':module.sha(Path(__file__).read_bytes()),
        'angleAdapterSha256':module.sha(Path(__file__).with_name('observe-shader-angle.py').read_bytes()),
        'inputs':inputs,'context':angle.info,'libraries':{name:module.sha((a.angle/name).read_bytes())for name in ['libEGL.dll','libGLESv2.dll']},
        'stages':[{'key':k,**{name:v for name,v in s.items()if name!='handle'}}for k,s in stages.items()],
        'programs':programs,'unresolvedSelections':proof['unsupportedPrograms'],
        'counts':{'compiled':len(stages),'compileFailures':sum(not s['success']for s in stages.values()),'linked':len(programs),'linkFailures':sum(not p['success']for p in programs),'unresolvedSelections':len(proof['unsupportedPrograms'])},
        'scope':{'browserRun':False,'desktopUsed':False,'gameRun':False,'pixelsCompared':False,'runtimeBindingsRecovered':False,'mainViewerIntegrated':False}}
    (cache/'research/attached-material-programs.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result['counts']),flush=True)
    if result['counts']['compileFailures']or result['counts']['linkFailures']:raise SystemExit('Native-selected shader failures recorded')


if __name__=='__main__':main()
