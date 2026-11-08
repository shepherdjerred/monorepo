"""Exercise the exact raster CLI's frozen-baseline boundary without rasterizing."""
import argparse
import ast
import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import numpy as np


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path)
    args=parser.parse_args()
    cache=args.cache.resolve()
    source=Path(__file__).with_name('render-shared-direct-playback.py').resolve()
    inputs={}
    def raw(path):
        path=Path(path).resolve(); data=path.read_bytes()
        inputs[str(path)]=hashlib.sha256(data).hexdigest()
        return data
    def read(path):return json.loads(raw(path))
    tree=ast.parse(raw(source),filename=str(source))
    main_node=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='main')
    boundary=next(node for node in main_node.body if isinstance(node,ast.If) and
        ast.unparse(node.test)=='args.comparison_projection')
    code=compile(ast.Module(body=[boundary],type_ignores=[]),str(source),'exec')
    projection_path=cache/'research/shared-direct-playback-v31-projection.json'
    frozen=read(projection_path)
    proof=read(cache/'research/shared-direct-playback-worker-v32-final.json')
    baseline_paths=[Path(path) for path in frozen['inputs'] if path.endswith('.json')]
    fixtures={str(path):read(path) for path in baseline_paths}
    adapter_path=source.with_name('render-particle-shader.py')
    cases=[]
    def run(name,mutate=None):
        state={'frozen':copy.deepcopy(frozen),'proof':copy.deepcopy(proof),'fixtures':copy.deepcopy(fixtures)}
        if mutate:mutate(state)
        def case_read(path):
            if Path(path)==projection_path:return state['frozen']
            return state['fixtures'][str(path)]
        env={'args':SimpleNamespace(comparison_projection=projection_path),'read':case_read,
             'raw':raw,'Path':Path,'adapter':SimpleNamespace(__file__=str(adapter_path),sha=lambda value:hashlib.sha256(value).hexdigest()),
             'np':np,'proof':state['proof'],'frames':state['proof']['snapshots'],'view':state['proof']['snapshots'][0]['camera']}
        try:
            exec(code,env)
            if mutate:raise AssertionError('Corrupt baseline admitted: '+name)
            cases.append({'case':name,'accepted':True})
        except ValueError as error:
            if not mutate:raise
            cases.append({'case':name,'accepted':False,'reason':str(error)})
    raster=next(path for path in fixtures if 'offscreen' in path)
    worker=next(path for path in fixtures if 'worker' in path)
    def put_frozen(field,value):return lambda s:s['frozen'].__setitem__(field,value)
    run('exact-immutable-v31-baseline')
    run('arbitrary-projection',put_frozen('projection',[0]*16))
    run('viewport-mismatch',put_frozen('viewport',[0,0,1024,512]))
    run('camera-mismatch',put_frozen('camera',{}))
    run('raster-worker-binding',lambda s:s['fixtures'][raster]['inputs'].__setitem__(next(p for p in fixtures[raster]['inputs'] if Path(p).name=='shared-direct-playback-worker.json'),'0'*64))
    run('baseline-camera-sequence',lambda s:s['fixtures'][worker]['snapshots'][1]['camera']['position'].__setitem__(0,6001))
    run('sample-clock',lambda s:s['fixtures'][raster]['frames'][1].__setitem__('time',69))
    run('source-counts',lambda s:s['fixtures'][worker]['sourceCounts'].__setitem__('heroAttacks',106))
    run('replay-source',lambda s:s['fixtures'][worker]['inputs'].__setitem__(next(p for p in fixtures[worker]['inputs'] if p.endswith('.rofl')),'0'*64))
    run('build-manifest',lambda s:s['fixtures'][worker]['inputs'].__setitem__(next(p for p in fixtures[worker]['inputs'] if p.replace('\\','/').endswith('latest-effects/manifest.json')),'0'*64))
    raw(Path(__file__))
    output=cache/'research/raster-baseline-binding-v33.json'
    output.write_text(json.dumps({'schema':1,'kind':'exact-raster-cli-baseline-binding-control','inputs':inputs,'cases':cases,
        'scope':{'exactCliBoundaryExecuted':True,'newGpuSubmission':False,'immutableV32Overwritten':False,'v33DiagnosticSource':True}},indent=2))
    print(json.dumps({'output':str(output),'cases':len(cases),'rejected':sum(not c['accepted'] for c in cases)}))


if __name__=='__main__':main()
