"""Load the original globals BIN into the genuine binary resource cache.

The complete signed-archive/controller bootstrap runs unchanged. This observer
requests the explicit original globals resource; it never inserts a cache row,
camera pointer, readiness bit, object or replacement serialized field.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from champion_catalog_native import initialize_binary_resource_cache, initialize_binary_postload_tls
from serialized_asset_progress_native import observe_serialized_asset_progress
from vfx_spawn_native import ADDRESSES
from ui_manager_native import NativeUiManager

bootstrap_path = Path(__file__).with_name('probe-archived-replay-ui-bootstrap.py')
spec = importlib.util.spec_from_file_location('camera_resource_original_bootstrap', bootstrap_path)
bootstrap = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bootstrap
spec.loader.exec_module(bootstrap)
mode_path = Path(__file__).with_name('probe-original-camera-mode-context.py')
mode_spec = importlib.util.spec_from_file_location('camera_resource_mode_context', mode_path)
mode_control = importlib.util.module_from_spec(mode_spec)
sys.modules[mode_spec.name] = mode_control
mode_spec.loader.exec_module(mode_control)


def same_initialized_camera_bytes(actual, expected):
    if len(actual) != 160 or len(expected) != 160:
        raise ValueError('Exact CameraConfig object extent required')
    # The original221D10 constructor initializes0..156 inclusive. Its final
    # boolean occupies156;157..159 are allocation padding, independently proven
    # by two poisoned placements with intact neighboring bytes.
    return actual[:157] == expected[:157]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['assets', 'client', 'installation', 'fixture_cache', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--typed-camera-control', type=Path)
    parser.add_argument('--constructor-default-mode', action='store_true')
    args = parser.parse_args()
    if args.constructor_default_mode and not args.typed_camera_control:
        raise ValueError('Constructor-default mode requires the typed camera control')
    if args.output.exists() or args.output.with_name(args.output.stem+'-bootstrap.json').exists():
        raise ValueError('Fresh original camera resource output required')
    tools = Path(__file__).resolve().parent
    paths = {Path(__file__).resolve()}
    for module in list(sys.modules.values()):
        filename = getattr(module, '__file__', None)
        if filename and Path(filename).suffix == '.py' and Path(filename).resolve().is_relative_to(tools):
            paths.add(Path(filename).resolve())
    sources = {str(file): hashlib.sha256(file.read_bytes()).hexdigest() for file in paths}
    observation = {'boundary': None}
    typed = None
    if args.typed_camera_control:
        typed_bytes = args.typed_camera_control.read_bytes()
        typed = json.loads(typed_bytes)
        if (typed['kind'] != 'original-classic-camera-constructor-field-control' or
                typed['build'] != '16.21.829.8620' or typed['protocol'] != '20e09df23c66b85e' or
                len(typed['authoredScalarChecks']) != 14 or typed['loaded']['size'] != 160 or
                typed['constructorInitializedBytes'] != 157 or
                typed['trailingPaddingOffsets'] != [157, 158, 159] or
                [row['poison'] for row in typed['constructorPaddingControls']] != [0xa5, 0x5a] or
                not all(row['neighborsUnchanged'] and row['initializedPrefixMatchesDefaults']
                        for row in typed['constructorPaddingControls'])):
            raise ValueError('Complete original typed CLASSIC camera scalar proof required')
        sources[str(args.typed_camera_control.resolve())] = hashlib.sha256(typed_bytes).hexdigest()
        original = bytes.fromhex(typed['loaded']['objectHex'])
        controls = []
        for offset in [0, 24, 156, 157, 158, 159]:
            changed = bytearray(original)
            changed[offset] ^= 1
            result = same_initialized_camera_bytes(changed, original)
            if result != (offset >= 157):
                raise ValueError('Camera comparison accepted a changed field or rejected proven padding')
            controls.append({'offset': offset, 'acceptedAsPaddingOnly': result})
        observation['typedComparisonControls'] = controls

    def observe(n):
        phase = 'original-cache-and-postload-tls'
        hooks = []
        try:
            observation['cache'] = initialize_binary_resource_cache(n)
            observation['tls'] = initialize_binary_postload_tls(n)
            phase = 'original-camera-reflection-registration'
            observation['characterTypes'] = n.initialize_character_types()
            n.call(0x22488a, {}, 0x224896)
            n.call(0x2248b0, {}, 0x2248bc)
            phase = 'original-full-globals-bin-loader'
            handle = n.allocate(16)
            n.call(0x14b7670, {r.UC_X86_REG_RDI: handle})
            name = n.allocate_text('globals')
            observation['serializedProgress'], hooks = observe_serialized_asset_progress(n)
            n.call(0x14ba7d0, {r.UC_X86_REG_RDI: handle, r.UC_X86_REG_RSI: name})
            observation['loader'] = {'entryRva': 0x14ba7d0, 'requestedPath': 'globals',
                                     'returnValue': n.u.reg_read(r.UC_X86_REG_RAX),
                                     'handleHex': bytes(n.u.mem_read(handle, 16)).hex()}
            if not n.u.reg_read(r.UC_X86_REG_RAX):
                raise ValueError('Original globals BIN loader did not succeed')
            phase = 'complete-resource-load-only'
            if typed is not None:
                constructor = typed['constructorSource']
                if (constructor['rva'] != 0x221d10 or constructor['bytes'] != 0x73 or
                        hashlib.sha256(n.image[0x221d10:0x221d83]).hexdigest() != constructor['sha256']):
                    raise ValueError('Original CameraConfig initialization instructions differ')
                if n.q(n.base+0x255cc80):
                    raise ValueError('Original camera config global must be cold')
                if args.constructor_default_mode:
                    phase = 'original-constructor-default-mode-context'
                    observation['modeContext'] = mode_control.initialize_constructor_default_camera_mode(n)
                    phase = 'complete-original-camera-config-selection'
                    n.call(0x219d20, {})
                else:
                    phase = 'explicit-original-classic-fallback-prefix'
                    # Execute the unchanged CLASSIC fallback branch, including
                    # native hashing/lookup/RTTI/publication, not preceding mode
                    # selection or following cleanup.
                    n.call(0x219e67, {r.UC_X86_REG_RBP: ADDRESSES['stack']-0x100}, 0x219eb9)
                published = n.q(n.base+0x255cc80)
                if not n.library_pointer(published, 160):
                    raise ValueError('Original cached camera escaped owned resource memory')
                actual_bytes = bytes(n.u.mem_read(published, 160))
                expected_bytes = bytes.fromhex(typed['loaded']['objectHex'])
                observation['typedCameraComparison'] = {'object': published,
                    'actualHex': actual_bytes.hex(), 'expectedHex': expected_bytes.hex(),
                    'differingOffsets': [index for index, (left, right) in
                                         enumerate(zip(actual_bytes, expected_bytes)) if left != right]}
                if not same_initialized_camera_bytes(actual_bytes, expected_bytes):
                    raise ValueError('Original cached camera initialized fields differ from typed control')
                n.call(0x219d10, {})
                if n.u.reg_read(r.UC_X86_REG_RAX) != published:
                    raise ValueError('Original camera getter differs from native publication')
                observation['classicFallback'] = {'entryRva': 0x219e67, 'endRva': 0x219eb9,
                    'object': published, 'all157InitializedBytesMatchTypedControl': True,
                    'uninitializedPaddingOffsets': [157, 158, 159],
                    'modeSelectionExecuted': args.constructor_default_mode,
                    'cleanupExecuted': args.constructor_default_mode,
                    'selectionEntryRva': 0x219d20 if args.constructor_default_mode else 0x219e67,
                    'acceptedReplayModeRecovered': False,
                    'nativeGetterReturnedPublishedObject': True}
                phase = 'complete-original-camera-input-service'
                self_started = not bool(n.q(n.base+0x2470640))
                if not self_started:
                    raise ValueError('Camera input service requires its original cold owner')
                n.camera_input_startup_active = True
                try:
                    n.call(0x60cda0, {})
                finally:
                    n.camera_input_startup_active = False
                input_owner = n.q(n.base+0x2470640)
                if n.allocations.get(input_owner) != 0x8b0:
                    raise ValueError('Original input-service allocation/publication differs')
                observation['inputService'] = {'entryRva': 0x60cda0, 'object': input_owner,
                    'bytes': 0x8b0, 'originalCompleteEntryReturned': True,
                    'zeroFillCalls': list(getattr(n, 'camera_input_zeroes', [])),
                    'platformEventsDispatched': False}
                phase = 'original-camera-allocation-and-complete-constructor'
                n.call(0xc588d1, {}, 0xc588e6)
                camera = n.u.reg_read(r.UC_X86_REG_R14)
                if n.allocations.get(camera) != 0x488:
                    raise ValueError('Original camera allocation extent differs')
                observation['camera'] = {'originalCallerPrefix': [0xc588d1, 0xc588e6],
                    'constructorRva': 0xc446f0, 'object': camera, 'bytes': 0x488,
                    'objectHex': bytes(n.u.mem_read(camera, 0x488)).hex()}
                phase = 'complete-original-camera-constructor-only'
        except Exception as error:
            observation['boundary'] = {'phase': phase, 'kind': type(error).__name__,
                'message': str(error), 'rva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                'registers': {name: n.u.reg_read(getattr(r, 'UC_X86_REG_'+name.upper()))
                              for name in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']}}
        finally:
            for hook in hooks:
                n.u.hook_del(hook)
            observation.update(phase=phase, originalBlocks=list(n.blocks.values()))

    parent = bootstrap.NativeArchivedReplayUiControl

    class CameraResourceControl(parent):
        def reject(self, uc, address, size, user):
            if (getattr(self, 'camera_input_startup_active', False) and
                    address-self.base == 0x1fee5fa and
                    self.source.imports.get(address-self.base) == '___bzero'):
                return
            return super().reject(uc, address, size, user)

        def imported(self, uc, address, size, user):
            if (not getattr(self, 'camera_input_startup_active', False) or
                    self.source.imports[address-self.base] != '___bzero'):
                return super().imported(uc, address, size, user)
            destination = uc.reg_read(r.UC_X86_REG_RDI)
            count = uc.reg_read(r.UC_X86_REG_RSI)
            caller = self.q(uc.reg_read(r.UC_X86_REG_RSP))-self.base
            # The full original event registry performs several ordinary C
            # clears before constructing its final owner. Reuse the existing
            # bounded C ABI rather than accumulating individual native caller
            # exceptions. Its single-owned-allocation/size guards stay intact;
            # this adapter is active only during the original60CDA0 call.
            allocation = next(((start, length) for start, length in self.allocations.items()
                               if start <= destination <= start+length-count), None)
            result = NativeUiManager.imported(self, uc, address, size, user)
            if not hasattr(self, 'camera_input_zeroes'):
                self.camera_input_zeroes = []
            self.camera_input_zeroes.append({'callerRva': caller, 'destination': destination,
                                            'allocation': allocation, 'bytes': count})
            return result

        def close_files(self):
            if not getattr(self, 'camera_resource_observed', False):
                self.camera_resource_observed = True
                observe(self)
            return super().close_files()

    bootstrap.NativeArchivedReplayUiControl = CameraResourceControl
    startup = args.output.with_name(args.output.stem+'-bootstrap.json')
    saved = sys.argv
    try:
        sys.argv = [str(bootstrap_path), str(args.assets), str(args.client), str(args.installation),
                    str(args.fixture_cache), str(startup)]
        bootstrap.main()
    finally:
        sys.argv = saved
    for file, digest in sources.items():
        if hashlib.sha256(Path(file).read_bytes()).hexdigest() != digest:
            raise ValueError('Original camera resource control source changed: '+file)
    startup_bytes = startup.read_bytes()
    if json.loads(startup_bytes)['boundary'] is not None:
        raise ValueError('Original complete archive/controller bootstrap did not finish')
    report = {'schema': 1, 'kind': 'original-signed-globals-bin-resource-control',
              'bootstrapReceiptSha256': hashlib.sha256(startup_bytes).hexdigest(),
              'sources': sources, **observation,
              'scope': {'explicitOriginalResourceRequested': True, 'cacheRowInjected': False,
                        'cameraGlobalPointerInjected': False, 'cameraStartupExecuted': False,
                        'browserCameraAdmitted': False, 'nativeSpectatorAdmitted': False}}
    args.output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'phase': observation['phase'],
                      'boundary': observation['boundary']}))
    if observation['boundary']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
