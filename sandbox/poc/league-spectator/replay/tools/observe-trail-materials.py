"""Observe the actual native material path for every admitted CameraTrail."""
import argparse
import inspect
import json
from pathlib import Path

from trail_material_native import NativeTrailMaterial
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        p.add_argument(name, type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    decoder, directory = cache/'public/decoder-16.21-macos', cache/'public/latest-trail-particles'
    raw = (directory/'package.json').read_bytes()
    meta = json.loads(raw)
    entries, blocks = [], {}
    for index, ref in enumerate(meta['templates']):
        if index % 40 == 0:
            n = NativeTrailMaterial(decoder, args.client)
        graph_raw = (directory/ref['file']).read_bytes()
        if sha(graph_raw) != ref['sha256']:
            raise ValueError('Trail material graph changed')
        graph = json.loads(graph_raw)
        n.prepare_trail_material(graph)
        parameters = n.parameters()
        samplers = n.samplers()
        env = {'pass':0,'featuresEnabled':True,'resourceMask':int(ref['hasMultDefinition']),
            'systemFogMode':1,'graphics34b':False,'graphics29c':0}
        selection = n.select(env)
        state = n.render_state(0)
        # Erosion needs a live per-particle drive; this observation does not
        # synthesize one. GPU admission will keep that dependency explicit.
        erosion = bool(n.q(0x10020000 + 0x38))
        n.finish()
        entries.append({**ref,'environment':env,'selection':selection,'renderState':state,
            'parameters':parameters,'samplers':samplers,'needsErosionDrive':erosion})
        blocks.update(n.material_blocks)
        if (index+1)%20 == 0:
            print(json.dumps({'emitters':index+1}),flush=True)
    paths={Path(inspect.getfile(c)) for c in NativeTrailMaterial.__mro__ if c is not object}
    paths.update([Path(__file__),Path(__file__).with_name('macho.py')])
    result={'schema':1,'kind':'native-complete-trail-materials','build':meta['build'],
        'protocol':meta['protocol'],'trailPackageSha256':sha(raw),
        'entries':entries,'originalBlocks':list(blocks.values()),
        'sources':{f.name:sha(f.read_bytes()) for f in sorted(paths)},
        'scope':{'completeAssetBytesUnchanged':True,'sceneEnvironmentSupplied':True,
            'resourcePresenceSupplied':True,'materialFactory':False,'gpuSubmitted':False}}
    (cache/'research/trail-materials-native.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'emitters':len(entries),'shaderPairs':len({
        (e['selection']['vertex'],e['selection']['pixel']) for e in entries})}))


if __name__ == '__main__':
    main()
