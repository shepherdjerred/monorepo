"""Unchanged CameraTrail regression assets through birth, bends and stable death.

Original pool/update and writer execute on explicitly supplied world, camera,
seeds and clocks. This does not recover original match activation/placement.
"""
import argparse
import inspect
import json
from pathlib import Path
from trail_particle_native import NativeTrailParticles
from vfx_spawn_native import sha, ADDRESSES as A

IDENTITY = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
YAW90 = [0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve(); assets = cache/'public'; directory = assets/'latest-trail-particles'
    raw = (directory/'package.json').read_bytes(); meta = json.loads(raw)
    n = NativeTrailParticles(assets/'decoder-16.21-macos', args.client)
    inputs = {str((directory/'package.json').resolve()): sha(raw)}
    cases = []
    for ref in meta['templates']:
        if ref['effectId'] != 'champions/vladimir/39/9fbafd14': continue
        path = directory/ref['file']; graph_raw = path.read_bytes()
        if sha(graph_raw) != ref['sha256']: raise ValueError('Trail asset changed')
        inputs[str(path.resolve())] = sha(graph_raw); graph = json.loads(graph_raw)
        for seed in [1, 987654321]:
            for motion in ['linear', 'bend']:
                n.reset_bound(graph, seed, 0, meta)
                frames = []; previous = [0,250,0]
                for tick in [0, 0, *range(1, 121)]:
                    time = tick/60
                    current = [time*130,250+time*3,time*70] if motion == 'linear' else [min(time,.4)*130,250+time*3,max(time-.4,0)*170]
                    basis = YAW90 if 30 <= tick < 70 else IDENTITY
                    inp = {'time':time,'previous':previous,'current':current,'basis':basis,
                        'viewPosition':[0,2000,1000],'cameraRight':[1,0,0],'cameraUp':[0,0,1],
                        'viewAxis':[0,1,0],'multTexturePresent':graph['hasMultDefinition']}
                    out = n.frame_bound(inp)
                    if bytes(n.u.mem_read(A['definition'],0x470)).hex() != graph['assetObjectHex'] or bytes(n.u.mem_read(graph['assetHeapStart'],graph['assetHeapBytes'])).hex() != graph['segments'][1]['bytesHex']:
                        raise ValueError('Original update mutated authored trail graph')
                    frames.append({'input':inp,'output':out}); previous = current
                cases.append({'effectId':ref['effectId'],'emitterIndex':ref['emitterIndex'],'graphSha256':ref['sha256'],
                    'seedHex':f'{seed:016x}','quality':0,'motion':motion,'originY':250,'frames':frames})
    if len(cases) != 12: raise ValueError('Expected all three Vladimir E regression trails')
    sources = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema':1,'kind':'native-direct-trail-schedule-control','build':meta['build'],'protocol':meta['protocol'],
        'packageSha256':sha(raw),'compilerSources':meta['compilerSources'],'inputs':inputs,
        'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},'cases':cases,'originalBlocks':list(n.blocks.values()),
        'scope':{'unchangedLoadedAssets':True,'suppliedWorldCameraSeedsAndClock':True,'repeatedTimeAndDeathTransitionsExecuted':True,
            'originalParentActivation':False,'actualMatchCoverage':False,'gpuSubmitted':False}}
    output = cache/'research/direct-trail-schedule-native.json'
    output.write_text(json.dumps(report,separators=(',',':'),allow_nan=False),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'frames':sum(len(c['frames']) for c in cases),'originalBlocks':len(n.blocks)}))

if __name__ == '__main__': main()
