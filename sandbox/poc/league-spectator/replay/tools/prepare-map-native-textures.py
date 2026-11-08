"""Inventory map textures from complete native graphs, including defaults.

This reads typed owned string fields only. Graphs with unresolved links remain
eligible for static inspection; the stricter runtime activation gate is retained.
"""
import argparse
import inspect
import json
from pathlib import Path
from vfx_system_asset_native import NativeVfxSystemAssets
from native_texture_dependencies import discover_native_texture_paths
from vfx_spawn_native import ADDRESSES as A,sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    assets = cache/'public'
    inputs = {}
    def raw(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = sha(data)
        return data
    def read(path):
        return json.loads(raw(path))
    package_path = assets/'latest-map-vfx-systems/package.json'
    package = read(package_path)
    map_inputs = read(assets/'latest-map-effect-inputs/package.json')
    if (package['kind'] != 'native-complete-map-vfx-systems' or
            package['mapInputsSha256'] != inputs[str((assets/'latest-map-effect-inputs/package.json').resolve())] or
            not package['scope']['allDeclaredRootsAttempted'] or
            package['counts']['attemptedRoots'] != map_inputs['definitions']['count']):
        raise ValueError('Complete installed map system preparation required')
    for name,digest in package['compilerSources'].items():
        if sha(raw(Path(__file__).with_name(name))) != digest:
            raise ValueError('Map native graph compiler changed: '+name)
    n = NativeVfxSystemAssets(assets/'decoder-16.21-macos',args.client)
    if package['decoderImageSha256'] != sha(n.image):
        raise ValueError('Map native texture decoder image differs')
    paths,by_effect = {},{}
    for index,(effect_id,ref) in enumerate(package['systems'].items()):
        path = assets/'latest-map-vfx-systems'/ref['file']
        graph = read(path)
        if sha(raw(path)) != ref['sha256'] or graph['effectId'] != effect_id:
            raise ValueError('Complete map graph bytes/identity differ')
        root,heap,start = bytes.fromhex(graph['objectHex']),bytes.fromhex(graph['heapHex']),graph['heapStart']
        if (graph['rootType'] != 0x45cd899f or len(root) != 0x160 or start != n.baseline_heap or
                start+len(heap) > 0x12000000 or graph['ignored'] or graph['mismatched']):
            raise ValueError('Static map texture graph exceeds its typed owned arena')
        n.load_system([])
        n.u.mem_write(A['definition'],root)
        n.u.mem_write(start,heap)
        n.next_heap = start+len(heap)
        # No runtime call follows these writes. This preserves pending links and
        # math observations instead of admitting their graphs for activation.
        found = discover_native_texture_paths(n,graph)
        by_effect[effect_id] = found
        for record in found:
            key = record['path'].lower()
            paths.setdefault(key,{'path':record['path'],'effects':[]})['effects'].append(effect_id)
        if index%100 == 0:
            print(json.dumps({'roots':index+1,'nativeTexturePaths':len(paths)}),flush=True)
    sources = {Path(__file__),Path(__file__).with_name('native_texture_dependencies.py'),Path(__file__).with_name('macho.py')}
    sources.update(Path(inspect.getfile(c)) for c in NativeVfxSystemAssets.__mro__ if c is not object)
    result = {'schema':1,'kind':'native-map-texture-dependency-inventory','build':package['build'],
        'protocol':package['protocol'],'mapSystemsSha256':inputs[str(package_path.resolve())],
        'inputs':inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},
        'effects':by_effect,'paths':paths,
        'counts':{'roots':len(by_effect),'uniqueTextures':len(paths),
            'nativeStringFields':sum(len(r['fields']) for roots in by_effect.values() for r in roots),
            'unpreparedSourceRoots':len(package['unprepared'])},
        'scope':{'typedNativeStringFields':True,'constructorDefaultsIncluded':True,'staticInspectionOnly':True,
            'externalLinksResolved':False,'runtimeActivationGateUnchanged':True,'graphicsResourcesCreated':False,
            'browserExecuted':False,'referenceCompared':False}}
    output = cache/'research/map-native-textures.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts']}))


if __name__ == '__main__':
    main()
