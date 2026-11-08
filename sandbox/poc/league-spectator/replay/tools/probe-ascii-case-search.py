"""Verify admitted strcasestr pointer, first-match and C-string boundaries."""
import argparse
import importlib.util
import inspect
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from ascii_case_search_native import STRCASESTR_RVA
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha

control_path = Path(__file__).with_name('probe-effect-callback-manager.py')
spec = importlib.util.spec_from_file_location('native_case_search_control', control_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class Control(module.Control):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    paths = {Path(__file__), control_path, Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    sources_before = {p.name: sha(p.read_bytes()) for p in sorted(paths)}
    controls = []
    for haystack, needle, offset in [
            (b'PrefixRECitemsSuffix', b'RecItems', 6),
            (b'AbAbaBa', b'bAB', 1), (b'AA[az]', b'[AZ]', 2),
            (b'abc', b'abcd', None), (b'abc', b'xyz', None),
            (b'abc', b'', 0), (b'', b'', 0), (b'', b'a', None),
            (b'a\0RECITEMS', b'RecItems', None),
            (b'PrefixRECITEMS', b'rec\0ignored', 6)]:
        pointers = []
        for value in [haystack, needle]:
            pointer = n.allocate(len(value) + 1)
            n.u.mem_write(pointer, value + b'\0')
            pointers.append(pointer)
        n.call(STRCASESTR_RVA, {r.UC_X86_REG_RDI: pointers[0], r.UC_X86_REG_RSI: pointers[1]})
        expected = pointers[0] + offset if offset is not None else 0
        if n.u.reg_read(r.UC_X86_REG_RAX) != expected:
            raise ValueError('ASCII strcasestr first-match pointer differs')
        if any(bytes(n.u.mem_read(pointer, len(value) + 1)) != value + b'\0'
               for pointer, value in zip(pointers, [haystack, needle])):
            raise ValueError('ASCII strcasestr mutated input memory')
        controls.append({'haystackHex': haystack.hex(), 'needleHex': needle.hex(),
                         'matchOffset': offset, 'matched': True})
    rejections = []
    for haystack, needle in [(b'\xe9abc', b'a'), (b'abc', b'\xe9')]:
        pointers = []
        for value in [haystack, needle]:
            pointer = n.allocate(len(value) + 1)
            n.u.mem_write(pointer, value + b'\0')
            pointers.append(pointer)
        try:
            n.call(STRCASESTR_RVA, {r.UC_X86_REG_RDI: pointers[0], r.UC_X86_REG_RSI: pointers[1]})
        except ValueError as error:
            if 'Non-ASCII strcasestr' not in str(error):
                raise
            rejections.append(str(error))
        else:
            raise ValueError('Unrecovered strcasestr locale was silently admitted')
    sources_after = {p.name: sha(p.read_bytes()) for p in sorted(paths)}
    if sources_before != sources_after:
        raise ValueError('Case-search producer changed during control')
    output = fixture.cache / 'research/ascii-case-search-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'decoderImageSha256': sha(n.image),
        'controls': controls, 'rejections': rejections,
        'platformCaseSearchCalls': n.ascii_case_search_calls,
        'inputs': fixture.inputs, 'sources': sources_after,
        'originalBlocks': list(n.blocks.values()), 'scope': {'platformAbiOnly': True,
            'explicitAsciiInputs': True, 'darwinLibraryImplementationExecuted': False,
            'nonAsciiLocaleBehaviorAdmitted': False, 'sourceFingerprintsVerifiedBeforeAndAfter': True,
            'gameFunctionSubstituted': False, 'acceptedReplayEntity': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls), 'rejections': len(rejections)}))


if __name__ == '__main__':
    main()
