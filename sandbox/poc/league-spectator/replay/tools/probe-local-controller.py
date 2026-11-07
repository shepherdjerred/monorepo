"""Preflight the original local-controller startup without constructing heroes."""
import argparse
import importlib.util
import inspect
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from local_controller_native import initialize_local_controller, CONSTRUCTOR_WITHOUT_LOG_WORKERS, COMPLETE_STARTUP
from native_ai_unit_fixture import NativeAIUnitFixture
from process_arguments_native import initialize_product_configuration
from read_only_client_directories_native import NativeReadOnlyClientDirectories
from bsd_string_copy_native import NativeBsdStringCopy
from libcpp_string_span_append_native import NativeLibcppStringSpanAppend
from client_loose_files_native import NativeClientLooseFiles
from cooperative_threads_native import NativeCooperativeThreads
from installed_resource_archive_native import register_resource_archive
from archive_subchunks_native import load_installed_subchunks
from vfx_spawn_native import sha

entry = Path(__file__).with_name('probe-recorded-hero-creation.py')
spec = importlib.util.spec_from_file_location('local_controller_dependencies', entry)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


class Control(runtime.Control):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('installation', type=Path)
    parser.add_argument('--without-log-workers', action='store_true',
                        help='Stop after the complete original constructor and guard omitted disk-log queues')
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    paths = runtime.producer_paths(n) | {Path(__file__), Path(inspect.getfile(initialize_local_controller)),
        Path(inspect.getfile(register_resource_archive)), Path(inspect.getfile(load_installed_subchunks))}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    setup, boundary = {}, None
    try:
        setup['looseFiles'] = n.configure_client_loose_files(args.installation / 'Game')
        setup['platformEntropy'] = n.configure_random_device_inputs('host-os-entropy')
        setup['machSemaphorePlatform'] = n.initialize_mach_semaphore_platform()
        setup['arena'] = n.initialize_asset_arena(64)
        setup['audio'] = n.initialize_audio_facade()
        setup['ui'] = n.initialize_ui_data_prefix()
        setup['product'] = initialize_product_configuration(n, 'LoL')
        setup['archives'] = []
        for name in ['DATA.wad.client', 'Global.wad.client', 'Bootstrap.windows.wad.client']:
            archive = register_resource_archive(fixture, args.installation, name)
            archive_path = Path(archive['path'])
            archive['subchunks'] = load_installed_subchunks(fixture, args.installation, archive_path,
                                                           archive['archive'], fixture.raw(archive_path))
            setup['archives'].append(archive)
        setup['bsdStringCopyControls'] = []
        for data, capacity in [(b'abcdef', 0), (b'abcdef', 1), (b'abcdef', 4), (b'abcdef', 7), (b'', 2)]:
            source, target = n.allocate_text(data.decode('ascii')), n.allocate(16)
            n.u.mem_write(target, bytes([0xa5]) * 16)
            n.call(0x1feede6, {r.UC_X86_REG_RDI: target, r.UC_X86_REG_RSI: source, r.UC_X86_REG_RDX: capacity})
            copied = min(len(data), max(0, capacity - 1))
            expected = data[:copied] + b'\0' + bytes([0xa5]) * (15 - copied) if capacity else bytes([0xa5]) * 16
            if n.u.reg_read(r.UC_X86_REG_RAX) != len(data) or bytes(n.u.mem_read(target, 16)) != expected:
                raise ValueError('BSD strlcpy return/termination/truncation/guard control differs')
            setup['bsdStringCopyControls'].append({'sourceBytes': len(data), 'capacity': capacity, 'copiedBytes': copied})
        path, error = n.allocate_text('/Config/'), n.allocate(4)
        n.call(0x144af00, {r.UC_X86_REG_RDI: path, r.UC_X86_REG_RSI: error})
        if n.u.reg_read(r.UC_X86_REG_RAX) & 255 or n.u32(error) != 30:
            raise ValueError('Original directory wrapper did not preserve platform EROFS failure')
        setup['readOnlyDirectoryControl'] = {'originalWrapperRva': 0x144af00, 'result': False, 'darwinErrno': 30}
        setup['localController'] = initialize_local_controller(n, policy=(
            CONSTRUCTOR_WITHOUT_LOG_WORKERS if args.without_log_workers else COMPLETE_STARTUP))
        if args.without_log_workers:
            controller = setup['localController']['object']
            untouched = bytes(n.u.mem_read(controller + 0x44b, 1))
            attempts = [lambda: n.u.mem_read(controller + 0x248, 1),
                        lambda: n.u.mem_write(controller + 0x248, b'\0'),
                        lambda: n.call(0x142b810, {r.UC_X86_REG_RDI: controller + 0x250})]
            for attempt in attempts:
                try:
                    attempt()
                except ValueError as error:
                    if 'controller disk-log queues without post-init' not in str(error):
                        raise
                else:
                    raise ValueError('Omitted local-controller log queue was silently accessed')
            if bytes(n.u.mem_read(controller + 0x44b, 1)) != untouched:
                raise ValueError('Disk-log guard control changed original selected slot')
            setup['omittedLogQueueGuardControls'] = len(attempts)
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
                    'registers': {key: n.u.reg_read(getattr(r, 'UC_X86_REG_' + key.upper()))
                                  for key in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']}}
        boundary['stackWords'] = [n.q(boundary['registers']['rsp'] + offset) for offset in range(0, 160, 8)]
        argument = boundary['registers']['rdi']
        boundary['argumentBytesHex'] = bytes(n.u.mem_read(argument, 128)).hex() if n.library_pointer(argument, 128) else None
    finally:
        n.close_files()
    loose_files = n.validate_client_loose_files()
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Local-controller source changed during execution: ' + path)
    output = fixture.cache / 'research/local-controller-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'setup': setup, 'boundary': boundary,
        'originalBlocks': list(n.blocks.values()), 'inputs': fixture.inputs, 'sources': sources,
        'directoryCalls': n.read_only_directory_calls,
        'bsdStringCopyCalls': n.bsd_string_copy_calls,
        'libcppAppendCalls': n.libcpp_append_calls,
        'libcppSpanAppendCalls': n.libcpp_span_append_calls,
        'physicalPresentationFiles': loose_files,
        'cooperativeThreads': n.cooperative_thread_summary(),
        'workerGameJobsExecuted': False,
        'platformEntropyCalls': n.random_device_calls,
        'machSemaphores': n.mach_semaphore_summary(),
        'machSemaphoreCalls': n.mach_semaphore_calls,
        'localControllerLogQueueAccesses': getattr(n, 'local_controller_log_accesses', []),
        'scope': {'originalStartupExecuted': boundary is None and not args.without_log_workers,
                  'originalConstructorPrefixExecuted': boundary is None and args.without_log_workers,
                  'liveClientSelectionRecovered': False,
                  'heroHandlerExecuted': False, 'mainViewerExpanded': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'boundary': boundary,
                     'localController': setup.get('localController')}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
