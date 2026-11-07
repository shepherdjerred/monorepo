"""Compare the graphics adapter with the pinned Rust library on original TOCs."""
import argparse
import hashlib
import itertools
import json
import subprocess
from pathlib import Path
from shader_permutation import select_permutation


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'package', 'compiler', 'rustc']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    inputs = {}

    def read(path):
        raw = path.read_bytes()
        inputs[str(path.resolve())] = digest(raw)
        return raw

    manifest = json.loads(read(args.package / 'package.json'))
    if manifest['build'] != '16.21.829.8620' or manifest['compiler']['pipelineVersion'] != 4:
        raise ValueError('Exact-build pipeline-v4 shader package required')
    sources_raw = read(args.compiler / 'sources.json')
    if digest(sources_raw) != manifest['compiler']['sourcesSha256']:
        raise ValueError('Pinned shader compiler sources manifest differs')
    sources = json.loads(sources_raw)
    for row in sources['files']:
        if digest(read(args.compiler / row['path'])) != row['sha256']:
            raise ValueError('Pinned shader compiler source changed: ' + row['path'])
    if digest(read(args.compiler / 'Cargo.lock')) != manifest['compiler']['lockSha256']:
        raise ValueError('Pinned shader compiler lock differs')
    dependencies = args.compiler / 'target/release/deps'
    libraries = {}
    for name in ['hexshade', 'serde_json']:
        matches = list(dependencies.glob('lib' + name + '-*.rlib'))
        if len(matches) != 1:
            raise ValueError('One explicit existing reference library required: ' + name)
        libraries[name] = matches[0]
        read(matches[0])
    root = Path(__file__).resolve().parent
    source = root / 'shader-selector-reference.rs'
    read(source)
    work = args.cache / 'research/shader-selector-comparison'
    work.mkdir(exist_ok=True)
    executable = work / 'reference.exe'
    command = [str(args.rustc), '--edition=2024', str(source), '-L', 'dependency=' + str(dependencies)]
    for name, library in libraries.items():
        command += ['--extern', name + '=' + str(library)]
    subprocess.run(command + ['-o', str(executable)], check=True, capture_output=True, timeout=120)
    read(executable)
    rows = []
    for stage in manifest['stages']:
        candidates = sorted((args.cache / 'research').glob('*/' + stage['tocSha256'] + '.toc'))
        if not candidates or digest(read(candidates[0])) != stage['tocSha256']:
            raise ValueError('Original shader TOC bytes required: ' + stage['file'])
        grouped = {}
        for definition in stage['baseDefines']:
            grouped.setdefault(definition['name'], set()).add(definition['value'])
        choices = [[None, *sorted(values)] for values in grouped.values()]
        size = 1
        for choice in choices:
            size *= len(choice)
        if size > 65536:
            raise ValueError('Reference enumeration exceeds its explicit subset bound')
        cases = []
        for combination in itertools.product(*choices):
            defines = [{'name': name, 'value': value} for name, value in zip(grouped, combination) if value is not None]
            cases.append({'id': len(cases), 'defines': defines})
        # Values absent from this stage must be filtered by the full macro hash.
        # Starting with valid subsets proves this can preserve a real record,
        # while replacing a required macro still proves missing permutations.
        for case in list(cases):
            if select_permutation(stage, case['defines'])['id'] is None:
                continue
            for extra in [{'name': '__UNDECLARED_CONTROL__', 'value': '1'},
                          *[{'name': name, 'value': '__UNDECLARED_VALUE__'} for name in grouped]]:
                defines = [d for d in reversed(case['defines']) if d['name'] != extra['name']] + [extra]
                cases.append({'id': len(cases), 'defines': defines})
        path = work / 'requests.json'
        path.write_text(json.dumps(cases), encoding='utf-8')
        result = subprocess.run([str(executable), str(candidates[0]), str(path)],
                                check=True, capture_output=True, text=True, timeout=60)
        observations = json.loads(result.stdout)
        if len(observations) != len(cases):
            raise ValueError('Shader reference omitted requests')
        selected, missing = 0, 0
        for case, observation in zip(cases, observations):
            actual = select_permutation(stage, case['defines'])
            if observation['id'] != case['id'] or observation['selectedRecordId'] != actual['id']:
                raise ValueError('Shader selector differs: ' + json.dumps({'stage': stage['file'], 'case': case,
                                                                        'reference': observation, 'actual': actual}))
            selected += actual['id'] is not None
            missing += actual['id'] is None
        rows.append({'file': stage['file'], 'stage': stage['stage'], 'requests': len(cases),
                     'selected': selected, 'missing': missing, 'mismatches': 0})
    for name in ['shader_permutation.py', 'compare-shader-permutations.py']:
        read(root / name)
    output = args.cache / 'research/shader-selector-comparison.json'
    output.write_text(json.dumps({'schema': 1, 'kind': 'pinned-library-shader-selector-comparison',
                                 'build': manifest['build'], 'stages': rows, 'inputs': inputs,
                                 'scope': {'originalTocBytes': True, 'independentRustLibrary': True,
                                           'nativeMacosBackendSelector': False, 'gpuCompilation': False,
                                           'visibleEffectCoverage': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'stages': len(rows),
                      'requests': sum(row['requests'] for row in rows), 'mismatches': 0}))


if __name__ == '__main__':
    main()
