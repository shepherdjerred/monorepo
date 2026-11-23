"""A/B original emitter field/postload execution with partial/full initializer."""
import argparse
import inspect
import json
from pathlib import Path

import unicorn
from unicorn import x86_const as r
from vfx_postload_native import NativeVfxPostload
from vfx_asset_native import UnsupportedAssetClass
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'client', 'fields', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Initializer audit output already exists')
    root = args.fields.resolve()
    manifest_bytes = (root/'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest['kind'] != 'original-scene-vfx-field-inputs':
        raise ValueError('Exact original VFX field inputs required')
    entries = {entry['file']: entry for entry in manifest['files']}
    inputs = {str(root/'manifest.json'): sha(manifest_bytes)}

    def raw(file):
        path = (root/file).resolve()
        if not path.is_relative_to(root):
            raise ValueError('VFX audit source escaped owned input root')
        data = path.read_bytes()
        if sha(data) != entries[file]['sha256'] or len(data) != entries[file]['bytes']:
            raise ValueError('Original VFX audit source changed')
        inputs[str(path)] = sha(data)
        return data

    request = json.loads(raw(manifest['input']))
    candidates = [entry for entry in request['emitters'] if entry['kind'] == 'complex' and entry['classHash'] == '09cde442']
    controls, remaining = [], candidates.copy()
    covered = set()
    for _ in range(8):
        if not remaining:
            break
        selected = max(remaining, key=lambda entry: (len({field['fieldHash'] for field in entry['fields']}-covered), sum(field['bytes'] for field in entry['fields'])))
        controls.append(selected)
        covered.update(field['fieldHash'] for field in selected['fields'])
        remaining.remove(selected)
    for selected in [min(candidates, key=lambda entry: len(entry['fields'])), max(candidates, key=lambda entry: sum(field['bytes'] for field in entry['fields']))]:
        if selected not in controls:
            controls.append(selected)
    partial = NativeVfxPostload(args.package, args.client)
    full = NativeVfxPostload(args.package, args.client)
    start = 0x1fef000
    before = bytes(partial.u.mem_read(partial.base+start, len(partial.image)-start))
    if before != bytes(full.u.mem_read(full.base+start, len(full.image)-start)):
        raise ValueError('Independent native VFX initialization baselines differ')
    full.call(0x14aa3bf, {}, end=0x14aa5f9)
    after = bytes(full.u.mem_read(full.base+start, len(full.image)-start))
    changed = {start+index for index, (left, right) in enumerate(zip(before, after)) if left != right}
    if not changed:
        raise ValueError('Full original initializer produced no diagnostic contrast')
    reads = [[], []]
    totals = [0, 0]
    active = {'control': None, 'phase': None}

    def hook(owner, slot):
        def read(uc, _kind, address, size, _value, _user):
            at = address-owner.base
            if not any(at+offset in changed for offset in range(size)):
                return
            totals[slot] += 1
            if len(reads[slot]) < 256:
                reads[slot].append({'control': active['control'], 'phase': active['phase'], 'rva': uc.reg_read(r.UC_X86_REG_RIP)-owner.base, 'addressRva': at, 'bytes': size, 'valueHex': bytes(uc.mem_read(address, size)).hex()})
        owner.u.hook_add(unicorn.UC_HOOK_MEM_READ, read, begin=owner.base+min(changed), end=owner.base+max(changed))
    hook(partial, 0)
    hook(full, 1)
    observations = []
    for index, control in enumerate(controls):
        data = raw(control['binFile'])
        if sha(data) != control['binSha256']:
            raise ValueError('Original emitter BIN digest differs')
        fields = []
        for field in control['fields']:
            span = data[field['offset']:field['offset']+field['bytes']]
            if len(span) != field['bytes'] or sha(span) != field['sha256']:
                raise ValueError('Original emitter field span differs')
            fields.append(span)
        outcomes = []
        for slot, owner in enumerate([partial, full]):
            active.update(control=index, phase='field-loading')
            try:
                loaded = owner.load(fields)
                active['phase'] = 'postload'
                postload = owner.postload()
                owner.restore_preload_arena()
                outcomes.append({'status': 'loaded-and-postloaded', 'loaded': loaded, 'postload': postload})
            except UnsupportedAssetClass as error:
                outcomes.append({'status': 'unsupported-original-class', 'reason': str(error)})
        observations.append({'effectId': control['effectId'], 'emitterIndex': control['emitterIndex'], 'sourceBinSha256': control['binSha256'], 'fields': control['fields'], 'partialStatus': outcomes[0]['status'], 'fullStatus': outcomes[1]['status'], 'equal': outcomes[0] == outcomes[1], 'partialSha256': sha(json.dumps(outcomes[0], sort_keys=True).encode()), 'fullSha256': sha(json.dumps(outcomes[1], sort_keys=True).encode())})
        print(json.dumps({'control': index, 'effect': control['effectId'], 'equal': observations[-1]['equal'], 'reads': totals}), flush=True)
    sources = {Path(__file__)}
    sources.update(Path(inspect.getfile(base)) for base in NativeVfxPostload.__mro__ if base is not object)
    for file, digest in inputs.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('VFX initializer audit input changed')
    result = {'schema': 1, 'kind': 'original-scene-vfx-initializer-audit', 'build': request['build'], 'protocol': request['protocol'], 'effectsManifestSha256': request['effectsManifestSha256'], 'inputManifestSha256': sha(manifest_bytes), 'decoderImageSha256': sha(partial.image), 'partialInitializer': [0x14aa3bf, 0x14aa516], 'fullInitializer': [0x14aa3bf, 0x14aa5f9], 'changedGlobals': [{'rva': at, 'partial': before[at-start], 'full': after[at-start]} for at in sorted(changed)], 'inputs': inputs, 'sources': {path.name: sha(path.read_bytes()) for path in sorted(sources)}, 'controls': observations, 'readCounts': totals, 'readExamples': reads, 'differentOutputs': sum(not row['equal'] for row in observations), 'nativeSpectatorAdmitted': False}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps({'output': str(args.output), 'controls': len(observations), 'changedBytes': len(changed), 'readCounts': totals, 'differentOutputs': result['differentOutputs']}))


if __name__ == '__main__':
    main()
