"""Compare single-call and sliced execution, including explicit budget failure."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from original_call_slices_native import call_original_sliced
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    baseline, sliced, unfinished = [n.allocate(0x130, 0xa5) for _ in range(3)]
    n.call(0x16b3670, {r.UC_X86_REG_RDI: baseline})
    record = {}
    call_original_sliced(n, 0x16b3670, {r.UC_X86_REG_RDI: sliced}, record,
                         maximum_slices=64, instructions_per_slice=2)
    if (len(record['slices']) <= 1 or not record['completed'] or
            bytes(n.u.mem_read(baseline, 0x30)) != bytes(n.u.mem_read(sliced, 0x30)) or
            n.q(n.base + 0x246c948) != sliced):
        raise ValueError('Sliced original constructor differs from its uninterrupted result')
    failed = {}
    try:
        call_original_sliced(n, 0x16b3670, {r.UC_X86_REG_RDI: unfinished}, failed,
                             maximum_slices=1, instructions_per_slice=1)
    except ValueError as error:
        if 'exhausted its finite CPU slice budget' not in str(error):
            raise
    else:
        raise ValueError('An unfinished original call was incorrectly accepted')
    if failed['completed'] or len(failed['slices']) != 1 or n.q(n.base + 0x246c948) != sliced:
        raise ValueError('Unfinished call returned completion or changed the later constructor state')
    rejected = []
    for label, options in [('slice-count', {'maximum_slices': 65}),
                           ('instruction-count', {'instructions_per_slice': 5000001}),
                           ('empty-budget', {'maximum_slices': 0})]:
        try:
            call_original_sliced(n, 0x16b3670, {}, {}, **options)
        except ValueError:
            rejected.append(label)
        else:
            raise ValueError('Original call did not reject ' + label)
    delegated = n.allocate(0x130, 0xa5)
    delegated_record, delegated_calls = {}, []
    def execute_slice(start, stop, bound):
        if bound != 2:
            raise ValueError('Delegated slice changed the original instruction bound')
        delegated_calls.append({'start': start, 'stop': stop, 'bound': bound})
        n.u.emu_start(start, stop, count=bound)
    call_original_sliced(n, 0x16b3670, {r.UC_X86_REG_RDI: delegated}, delegated_record,
                         instructions_per_slice=2, execute_slice=execute_slice)
    if (not delegated_record['completed'] or len(delegated_calls) != len(record['slices']) or
            bytes(n.u.mem_read(delegated, 0x30)) != bytes(n.u.mem_read(baseline, 0x30)) or
            n.q(n.base + 0x246c948) != delegated):
        raise ValueError('Delegated original slices did not retain the same result/context')
    for pointer in [baseline, sliced, unfinished, delegated]:
        if bytes(n.u.mem_read(pointer + 0x30, 0x100)) != b'\xa5' * 0x100:
            raise ValueError('Original sliced constructor escaped its owned object')
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(call_original_sliced)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'completed': record, 'incompleteRejected': failed, 'invalidBudgetsRejected': rejected,
              'delegated': delegated_record, 'delegatedCalls': delegated_calls,
              'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'uninterruptedConstructorAgreement': True, 'allocationGuardsChecked': True,
                        'incompleteCallAccepted': False, 'mainViewerExpanded': False}}
    output = fixture.cache / 'research/original-call-slices-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'matchingSlices': len(record['slices']),
                      'incompleteRejected': True, 'invalidBudgetsRejected': rejected}))


if __name__ == '__main__':
    main()
