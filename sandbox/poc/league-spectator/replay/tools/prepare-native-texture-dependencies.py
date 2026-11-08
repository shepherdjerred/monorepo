"""Inventory texture dependencies from complete typed native asset graphs."""
import argparse,inspect,json
from pathlib import Path
from vfx_object_native import NativeVfxObjects
from native_texture_dependencies import discover_native_texture_paths
from vfx_spawn_native import sha

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:parser.add_argument(name,type=Path)
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public';inputs={}
    def read(path):
        data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return json.loads(data)
    systems=read(assets/'latest-vfx-system-assets/package.json');effects=read(assets/'latest-effects/manifest.json')
    n=NativeVfxObjects(assets/'decoder-16.21-macos',args.client);by_effect={};paths={};fields=0
    for index,(effect,ref) in enumerate(systems['systems'].items()):
        path=assets/'latest-vfx-system-assets'/ref['file'];graph=read(path)
        if inputs[str(path.resolve())]!=ref['sha256']:raise ValueError('Native dependency graph changed')
        n.load_prepared_system(graph);found=discover_native_texture_paths(n,graph);by_effect[effect]=found
        for record in found:
            key=record['path'].lower();entry=paths.setdefault(key,{'path':record['path'],'effects':[],
                'preparedInEffectsManifest':effects['assets'].get(key,{}).get('status')=='prepared'})
            entry['effects'].append(effect);fields+=len(record['fields'])
        if index%200==0:print(json.dumps({'roots':index+1,'nativeTexturePaths':len(paths)}),flush=True)
    sources={Path(inspect.getfile(c)) for c in NativeVfxObjects.__mro__ if c is not object}
    sources.update([Path(__file__),Path(__file__).with_name('native_texture_dependencies.py'),Path(__file__).with_name('macho.py')])
    counts={'roots':len(by_effect),'uniqueTextures':len(paths),'nativeStringFields':fields,
        'missingPreparedTextures':sum(not p['preparedInEffectsManifest'] for p in paths.values())}
    result={'schema':1,'kind':'native-texture-dependency-inventory','build':systems['build'],'protocol':systems['protocol'],
        'inputs':inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},
        'effects':by_effect,'paths':paths,'counts':counts,
        'scope':{'typedNativeStringFields':True,'constructorDefaultsIncluded':True,'gameRuntimeExecuted':False,
            'graphicsResourcesCreated':False,'browserRun':False,'referenceCompared':False}}
    (cache/'research/native-texture-dependencies.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'counts':counts,'missing':[key for key,p in paths.items() if not p['preparedInEffectsManifest']]}))

if __name__=='__main__':main()
