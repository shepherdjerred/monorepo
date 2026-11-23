"""Original constructor-default mode context used by camera configuration.

This does not recover a replay's accepted mode. Its empty mode string is the
original constructor output, not a supplied CLASSIC label or context field.
"""
import argparse
import inspect
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from ui_manager_native import NativeUiManager
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import sha


def initialize_constructor_default_camera_mode(n):
    if n.q(n.base+0x246d020):
        raise ValueError('Original constructor-default mode context must be cold')
    n.call(0x66d18d, {}, 0x66d1a9)
    owner = n.q(n.base+0x246d020)
    if n.allocations.get(owner) != 0x208:
        raise ValueError('Original mode context allocation/publication differs')
    n.call(0x620940, {r.UC_X86_REG_RDI: owner})
    name = n.u.reg_read(r.UC_X86_REG_RAX)
    if n.cstring(name) != b'':
        raise ValueError('Original constructor-default mode name is not empty')
    return {'originalCaller': [0x66d18d, 0x66d1a9], 'constructorRva': 0x61ee20,
            'baseConstructorRva': 0x61e8b0, 'object': owner, 'bytes': 0x208,
            'modeGetterRva': 0x620940, 'modeString': '', 'modeStringPointer': name,
            'modeFieldDirectlyAssigned': False, 'acceptedReplayModeRecovered': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'client', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Fresh original mode-context receipt required')
    tools = Path(__file__).resolve().parent
    paths = {Path(__file__).resolve(), *[Path(inspect.getfile(base)).resolve()
                                       for base in NativeCharacterAssets.__mro__ if base is not object]}
    for module in list(sys.modules.values()):
        filename = getattr(module, '__file__', None)
        if filename and Path(filename).suffix == '.py' and Path(filename).resolve().is_relative_to(tools):
            paths.add(Path(filename).resolve())
    inputs = {str(file.resolve()): sha(file.read_bytes())
              for file in paths | {args.package/'profile.json', args.package/'image.bin', args.client}}
    n = NativeCharacterAssets(args.package, args.client)
    boundary, observed, product = None, None, None
    try:
        NativeUiManager.initialize_layout_constants(n)
        product = initialize_product_configuration(n, 'LoL')
        observed = initialize_constructor_default_camera_mode(n)
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'rva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'registers': {name: n.u.reg_read(getattr(r, 'UC_X86_REG_'+name.upper()))
                                  for name in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']}}
    for file, digest in inputs.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Original mode context input/source changed: '+file)
    result = {'schema': 1, 'kind': 'original-constructor-default-camera-mode-context',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'boundary': boundary, 'observed': observed,
              'product': product, 'inputs': inputs, 'originalBlocks': list(n.blocks.values()),
              'scope': {'originalConstructorAndGetterExecuted': observed is not None,
                        'acceptedReplayModeRecovered': False, 'cameraConfigSelected': False,
                        'nativeSpectatorAdmitted': False}}
    args.output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'observed': observed, 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
