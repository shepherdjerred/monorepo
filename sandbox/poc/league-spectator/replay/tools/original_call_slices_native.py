"""Retain one original call across a finite number of bounded CPU slices."""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


def call_original_sliced(n, entry, registers, record, maximum_slices=64,
                         instructions_per_slice=5000000, on_slice=None, execute_slice=None):
    if (type(entry) is not int or not 0 <= entry < 0x1fef000 or
            type(maximum_slices) is not int or not 1 <= maximum_slices <= 64 or
            type(instructions_per_slice) is not int or not 1 <= instructions_per_slice <= 5000000):
        raise ValueError('Original call entry and finite CPU slice bounds required')
    if execute_slice is not None and not callable(execute_slice):
        raise ValueError('A bounded original slice executor must be callable')
    record.update(entryRva=entry, maximumSlices=maximum_slices,
                  instructionsPerSlice=instructions_per_slice, delegatedSlices=execute_slice is not None,
                  completed=False, slices=[])
    n.u.context_restore(n.initial)
    n.put(ADDRESSES['stack'], 'Q', ADDRESSES['stop'])
    n.u.reg_write(r.UC_X86_REG_RSP, ADDRESSES['stack'])
    for register, value in registers.items():
        n.u.reg_write(register, value)
    start = n.base + entry
    for index in range(maximum_slices):
        try:
            if execute_slice is None:
                n.u.emu_start(start, ADDRESSES['stop'], count=instructions_per_slice)
            else:
                execute_slice(start, ADDRESSES['stop'], instructions_per_slice)
        finally:
            start = n.u.reg_read(r.UC_X86_REG_RIP)
            row = {'slice': index + 1, 'stop': start, 'nextHeap': n.next_heap,
                   'fileCalls': len(getattr(n, 'file_calls', [])),
                   'libraryCalls': len(getattr(n, 'library_calls', []))}
            record['slices'].append(row)
        if on_slice:
            on_slice(row)
        if start == ADDRESSES['stop']:
            record['completed'] = True
            return record
    raise ValueError(f'Original call {entry:x} exhausted its finite CPU slice budget')
