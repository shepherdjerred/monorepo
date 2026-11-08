"""Compile the exact prepared ground-pass programs without scene substitutes."""
import argparse
import importlib.util
import json
from pathlib import Path

from vfx_spawn_native import sha


spec = importlib.util.spec_from_file_location('ground_draw', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('angle', type=Path)
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}

    def raw(path):
        data = path.read_bytes()
        inputs[str(path)] = sha(data)
        return data

    path = cache / 'public/latest-direct-ground-materials/package.json'
    package_raw = raw(path)
    package = json.loads(package_raw)
    for filename, expected in package['inputs'].items():
        if sha(raw(Path(filename))) != expected:
            raise ValueError('Ground static material input changed: ' + filename)
    renderer = adapter.Draw(args.angle)
    programs = {}
    try:
        for attempt in package['attempts']:
            refs = attempt['shaderProgram']
            key = tuple(refs[s]['sha256'] for s in ['vertex', 'pixel'])
            if key in programs:
                continue
            stages = []
            for stage in ['vertex', 'pixel']:
                ref = refs[stage]
                data = raw(cache / 'public/latest-shaders' / ref['file'])
                if sha(data) != ref['sha256']:
                    raise ValueError('Ground shader bytes changed')
                stages.append(json.loads(data))
            handle = renderer.program(*stages)
            renderer.gl.glDeleteProgram(handle)
            programs[key] = refs
    finally:
        renderer.close()
    for filename in [Path(__file__), Path(adapter.__file__), Path(adapter.adapter.__file__)]:
        raw(filename)
    for filename in ['libEGL.dll', 'libGLESv2.dll']:
        raw(args.angle / filename)
    report = {'schema': 1, 'kind': 'ground-pass-program-compilation-controls',
              'packageSha256': sha(package_raw), 'context': renderer.info,
              'programs': list(programs.values()), 'inputs': inputs,
              'counts': {'components': len(package['attempts']), 'uniquePrograms': len(programs),
                         'shaderStages': len(package['shaderStages']), 'compileFailures': 0, 'linkFailures': 0},
              'scope': {'actualGroundPass5Programs': True, 'offscreenCompiledAndLinked': True,
                        'fowUniformOrTextureBound': False, 'sceneResourcesSubstituted': False,
                        'gpuDrawSubmitted': False, 'browserRun': False, 'matchCoverage': False}}
    output = cache / 'research/direct-ground-gpu-observation.json'
    output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'counts': report['counts']}))


if __name__ == '__main__':
    main()
