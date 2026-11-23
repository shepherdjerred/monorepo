"""Actual original inactive-AppKit continuation and strict platform controls."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from offscreen_application_native import original_offscreen_application
from vfx_spawn_native import sha
from libcpp_concat_native import read_libcpp_string


driver = Path(__file__).with_name('probe-original-vfx-manager-startup.py')
spec = importlib.util.spec_from_file_location('offscreen_original_control', driver)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['assets', 'client', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--scheduler-source', type=Path)
    parser.add_argument('--condition-source', type=Path)
    parser.add_argument('--condition-types-source', type=Path)
    args = parser.parse_args()
    tools = Path(__file__).resolve().parent
    sources = {}
    for module in list(sys.modules.values()):
        file = getattr(module, '__file__', None)
        if file and Path(file).resolve().is_relative_to(tools) and Path(file).suffix == '.py':
            source = Path(file).resolve()
            sources[str(source)] = sha(source.read_bytes())
    inputs = {str(path.resolve()): sha(path.read_bytes()) for path in
              [args.client, args.assets/'image.bin', args.assets/'profile.json']}
    if args.scheduler_source:
        inputs[str(args.scheduler_source.resolve())] = sha(args.scheduler_source.read_bytes())
    if bool(args.condition_source) != bool(args.condition_types_source):
        parser.error('Condition source/type references must be supplied together')
    for path in [args.condition_source, args.condition_types_source]:
        if path:
            inputs[str(path.resolve())] = sha(path.read_bytes())
    n = runtime.Control(args.assets, args.client)
    result = {}
    with original_offscreen_application(n, result):
        n.call(0x15e1080, {r.UC_X86_REG_RDI: 1})
        result['originalContinuationResult'] = n.u.reg_read(r.UC_X86_REG_RAX)
        if result['originalContinuationResult'] != 1002:
            raise ValueError('Original inactive continuation lost explicit invalid window-server connection')
        app = n.q(n.q(n.base+0x22e0018))
        bad = n.allocate_text('unsupportedSelector:')
        try:
            n.call(0x15e10c4, {r.UC_X86_REG_RDI: app, r.UC_X86_REG_RSI: bad}, end=0x15e10ca)
        except ValueError as error:
            if 'Unsupported offscreen AppKit message' not in str(error):
                raise
        else:
            raise ValueError('Unknown original AppKit selector was silently accepted')
        result['unknownSelectorRejected'] = True
        try:
            with original_offscreen_application(n, {}):
                raise AssertionError('Unexpected nested platform ownership')
        except ValueError as error:
            if 'not reentrant' not in str(error):
                raise
        else:
            raise ValueError('Nested offscreen platform ownership was silently accepted')
        result['reentrancyRejected'] = True
    cleanup = {}
    try:
        with original_offscreen_application(n, cleanup):
            raise LookupError('deliberate-owned-platform-failure')
    except LookupError:
        pass
    if not result['platformBindingsRestored'] or not cleanup['platformBindingsRestored']:
        raise ValueError('Offscreen platform cleanup did not restore all original data bindings')
    version_cases = []
    packed = (16 << 48) | (21 << 32) | (829 << 16) | 8620
    for text, expected in [('', None), ('16.21.829.8620', packed),
            ('0x10.025.01475.0x21ac', packed), ('1.2.3', None), ('-1.2.3.4', None),
            ('65535.65535.65535.65535', 0xffffffffffffffff), ('65536.1.2.3', None),
            ('1 2.3.4.5', None)]:
        source, output = n.allocate_text(text), n.allocate(8)
        n.put(output, 'Q', 0xa5a5a5a5a5a5a5a5)
        n.call(0x14dc700, {r.UC_X86_REG_RDI: source, r.UC_X86_REG_RSI: output})
        success = n.u.reg_read(r.UC_X86_REG_RAX) & 0xff
        actual = n.q(output)
        if success != int(expected is not None) or actual != (expected or 0):
            raise ValueError('Original version consumer differs from exact C conversion/range contract')
        row = {'text': text, 'success': success, 'packed': actual}
        if expected is not None:
            target = n.allocate(24)
            n.call(0x14dc7d0, {r.UC_X86_REG_RDI: target, r.UC_X86_REG_RSI: actual})
            canonical = read_libcpp_string(n, target).decode('ascii')
            reference = '.'.join(str((actual >> shift) & 65535) for shift in [48, 32, 16, 0])
            if canonical != reference:
                raise ValueError('Original packed-version formatter string differs')
            row['originalFormatted'] = canonical
        version_cases.append(row)
    try:
        n.call(0x144c180, {r.UC_X86_REG_RDI: n.allocate_text('1.2.3.4'),
                          r.UC_X86_REG_RSI: n.allocate_text('%i.%i.%i.%i')})
    except ValueError as error:
        if 'Unowned original client-version integer scan caller' not in str(error):
            raise
    else:
        raise ValueError('Unowned native version scan caller was silently accepted')
    scheduler = None
    if args.scheduler_source:
        scheduler = n.configure_scheduler_queries(args.scheduler_source.read_bytes(), default_user_priority=31)
        description = n.allocate(0x148)
        n.u.mem_write(description+0x48, b'\xa5'*0x100)
        n.call(0x1caf470, {r.UC_X86_REG_RDI: description})
        if (n.u32(description+0x20) != 47 or n.u32(description+0x30) != 4 or
                n.q(description+0x28) != 0x20000 or
                bytes(n.u.mem_read(description+0x48, 0x100)) != b'\xa5'*0x100 or
                [row['result'] for row in scheduler['calls']] != [47, 15, 15, 47]):
            raise ValueError('Original SDK description constructor differs from pinned scheduler-query inputs')
        scheduler['originalDescriptionHex'] = bytes(n.u.mem_read(description, 0x48)).hex()
        for entry, policy in [(0x1caf4aa, 0), (0x1feece4, 4)]:
            try:
                n.call(entry, {r.UC_X86_REG_RDI: policy})
            except ValueError as error:
                if 'Unowned original scheduler priority query caller/policy' not in str(error):
                    raise
            else:
                raise ValueError('Unknown scheduler caller/policy was silently accepted')
        scheduler['unknownCallerAndPolicyRejected'] = True
    conditions = None
    if args.condition_source:
        conditions = n.configure_condition_objects(args.condition_source.read_bytes(), args.condition_types_source.read_bytes())
        attr, cond = n.allocate(0x20), n.allocate(0x40)
        n.u.mem_write(attr, b'\xa5'*0x20)
        n.u.mem_write(cond, b'\xa5'*0x40)
        n.call(0x1cb1d53, {r.UC_X86_REG_RDI: attr}, end=0x1cb1d58)
        n.call(0x1cb1d76, {r.UC_X86_REG_RDI: cond, r.UC_X86_REG_RSI: attr}, end=0x1cb1d7b)
        if (bytes(n.u.mem_read(attr+16, 16)) != b'\xa5'*16 or
                bytes(n.u.mem_read(cond+48, 16)) != b'\xa5'*16 or conditions['conditions'][cond]['waiters']):
            raise ValueError('Owned condition initialization changed guards or fabricated waiters')
        n.call(0x1cb1db6, {r.UC_X86_REG_RDI: attr}, end=0x1cb1dbb)
        fresh = n.allocate(48)
        before = bytes(n.u.mem_read(fresh, 48))
        try:
            n.call(0x1cb1d76, {r.UC_X86_REG_RDI: fresh, r.UC_X86_REG_RSI: attr}, end=0x1cb1d7b)
        except ValueError as error:
            if 'Owned cold condition/attribute storage' not in str(error):
                raise
        else:
            raise ValueError('Destroyed condition attribute was silently reused')
        if bytes(n.u.mem_read(fresh, 48)) != before:
            raise ValueError('Rejected condition creation changed its destination')
        conditions['destroyedAttributeRejectedBeforeMutation'] = True
        pristine = n.allocate(48)
        def source_call(entry, registers, end):
            hook = n.u.hook_add(unicorn.UC_HOOK_CODE,
                lambda engine, at, size, user: engine.emu_stop(), begin=n.base+end, end=n.base+end)
            try:
                n.call(entry, registers, end=end)
            finally:
                n.u.hook_del(hook)
        source_call(0x1bc3a15, {r.UC_X86_REG_RDI: pristine, r.UC_X86_REG_RSI: 0}, 0x1bc3a1a)
        before = bytes(n.u.mem_read(pristine, 48))
        source_call(0x1c3354b, {r.UC_X86_REG_RDI: pristine}, 0x1c33550)
        if bytes(n.u.mem_read(pristine, 48)) != before or n.u.reg_read(r.UC_X86_REG_RAX):
            raise ValueError('Empty original condition broadcast changed storage or returned an error')
        conditions['conditions'][pristine]['waiters'] = 1
        try:
            source_call(0x1c3354b, {r.UC_X86_REG_RDI: pristine}, 0x1c33550)
        except ValueError as error:
            if 'wakes remain unadmitted' not in str(error):
                raise
        else:
            raise ValueError('Unadmitted condition waiters were silently woken')
        finally:
            conditions['conditions'][pristine]['waiters'] = 0
        if bytes(n.u.mem_read(pristine, 48)) != before:
            raise ValueError('Rejected condition broadcast changed its storage')
        conditions['emptyBroadcastNoFutureSignalAndUnadmittedWaiterControls'] = True
    for file, expected in {**inputs, **sources}.items():
        if sha(Path(file).read_bytes()) != expected:
            raise ValueError('Offscreen platform control source changed: '+file)
    args.output.write_text(json.dumps({'schema': 1, 'kind': 'original-offscreen-application-component-controls',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'sources': sources, 'inputs': inputs, 'result': result, 'failureCleanup': cleanup,
        'versionCases': version_cases, 'versionUnownedCallerRejected': True,
        'versionScans': getattr(n, 'client_version_scan_calls', []),
        'versionStrings': getattr(n, 'client_version_string_calls', []),
        'schedulerQueries': scheduler,
        'conditionObjects': conditions,
        'originalBlocks': list(n.blocks.values()), 'nativeGameOrAppKitReadinessAdmitted': False}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'messages': len(result['platformState']['messages']),
        'platformCalls': len(result['platformState']['platformCalls']),
        'unknownSelectorRejected': True, 'reentrancyRejected': True, 'failureBindingsRestored': True}))


if __name__ == '__main__':
    main()
