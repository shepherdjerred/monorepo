"""Inspect original authored animation type constructors and native ABI slots.

Disassembly is source evidence only. It does not execute live provider updates
or admit graph state inferred from those instructions.
"""
import argparse
import inspect
import json
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from unicorn import x86_const as r
from animation_provider_native import create_animation_provider_fixture
import animation_provider_native as provider_module
from vfx_spawn_native import name_hash, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'snapshot_bindings', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    files = {Path(__file__)}
    for value in vars(provider_module).values():
        if inspect.isfunction(value) or inspect.isclass(value):
            candidate = Path(inspect.getfile(value)).resolve()
            if candidate.parent == root:
                files.add(candidate)
    for klass in provider_module.NativeAnimationProvider.__mro__:
        if klass is not object:
            files.add(Path(inspect.getfile(klass)))
    sources = {str(file.resolve()): sha(file.read_bytes()) for file in files}
    bindings_bytes = args.snapshot_bindings.read_bytes()
    fixture = create_animation_provider_fixture(args.cache, args.client, json.loads(bindings_bytes))
    n = fixture.native
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    types = []
    for name in ['IsMovingParametricUpdater', 'IsHomeguardParametricUpdater', 'MoveSpeedParametricUpdater',
                 'LogicDriverBoolParametricUpdater', 'HasBuffDynamicMaterialBoolDriver',
                 'ConditionBoolClipData', 'ConditionFloatClipData', 'ParametricClipData']:
        identity = name_hash(name)
        descriptor = n.types.get(identity)
        if descriptor is None:
            raise ValueError('Original authored provider class absent: '+name)
        size = n.q(descriptor+0x40)
        constructor = n.q(descriptor+0x20)
        if not 8 <= size <= 0x4000 or not n.base <= constructor < n.base+len(n.image):
            raise ValueError('Original authored provider extent/constructor differs')
        data = n.allocate(size+16)
        n.u.mem_write(data+size, b'\xa5'*16)
        n.call(constructor-n.base, {r.UC_X86_REG_RDI: data})
        if bytes(n.u.mem_read(data+size, 16)) != b'\xa5'*16:
            raise ValueError('Original authored provider constructor escaped its extent')
        table = n.q(data)
        slots = []
        for offset in range(0, 0x60, 8):
            target = n.q(table+offset)-n.base
            if not 0 <= target < 0x1fef000:
                slots.append({'offset': offset, 'value': target})
                continue
            instructions = []
            for insn in md.disasm(n.image[target:target+512], target):
                instructions.append({'rva': insn.address, 'bytes': insn.bytes.hex(),
                                     'mnemonic': insn.mnemonic, 'operands': insn.op_str})
                if insn.mnemonic == 'ret':
                    break
            slots.append({'offset': offset, 'targetRva': target, 'instructions': instructions,
                          'windowSha256': sha(n.image[target:target+512])})
        types.append({'name': name, 'classHash': identity, 'descriptorRva': descriptor-n.base,
                      'constructorRva': constructor-n.base, 'bytes': size, 'objectHex': bytes(n.u.mem_read(data,size)).hex(),
                      'vtableRva': table-n.base, 'slots': slots})
    for file, expected in sources.items():
        if sha(Path(file).read_bytes()) != expected:
            raise ValueError('Original provider inspection source changed: '+file)
    for file, expected in fixture.inputs.items():
        if sha(Path(file).read_bytes()) != expected:
            raise ValueError('Original provider inspection input changed: '+file)
    output = {'schema': 1, 'kind': 'original-animation-provider-method-inventory',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'sources': sources, 'inputs': fixture.inputs,
              'snapshotBindingsSha256': sha(bindings_bytes), 'types': types,
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalTypedConstructorsExecuted': True, 'liveProviderStateEstablished': False,
                        'nativeGraphStateAdmitted': False}}
    args.output.write_text(json.dumps(output, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'types': len(types)}))


if __name__ == '__main__':
    main()
