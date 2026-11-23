"""Original replay-camera factory and explicit FoW action prefix controls.

The real controller constructor owns every receiver field. The callback runs
from entry through its original FoW setter; its later GUI refresh is a separate
boundary. No global flag or receiver readiness byte is assigned by this tool.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from ui_manager_native import NativeUiManager
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'client', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Fresh original perspective proof required')
    sources = {Path(__file__), *[Path(inspect.getfile(base)) for base in NativeUiManager.__mro__ if base is not object]}
    inputs = {str(path.resolve()): sha(path.read_bytes()) for path in sources | {args.client, args.package/'profile.json', args.package/'image.bin'}}
    n = NativeUiManager(args.package, args.client)
    n.initialize_layout_constants()
    n.call(0xf0c0f0, {})
    owner = n.u.reg_read(r.UC_X86_REG_RAX)
    if n.allocations.get(owner) != 0x340 or bytes(n.u.mem_read(owner+0x310, 1)) != b'\0':
        raise ValueError('Complete original replay-camera constructor required')
    constructor = bytes(n.u.mem_read(owner, 0x340)).hex()
    selected = bytes(n.u.mem_read(owner+0x1dc, 1))[0]
    sentinel = bytes(n.u.mem_read(n.base+0x2566b40, 1))[0]
    rows = []

    def action(enabled):
        if type(enabled) is not bool:
            raise ValueError('Explicit boolean native FoW action required')
        # Execute the complete original entry/guard/branch and the genuine
        # setter call. Stop only before its subsequent property/widget refresh.
        end = 0xf03de7 if enabled else 0xf03e1c
        n.call(0xf03da0, {r.UC_X86_REG_RDI: owner, r.UC_X86_REG_RSI: int(enabled)}, end=end)
        disabled = bytes(n.u.mem_read(n.base+0x24967c8, 1))[0]
        filter_bytes = bytes(n.u.mem_read(n.base+0x255cc88, 2))
        if disabled != int(not enabled) or filter_bytes != bytes([int(enabled), selected if enabled else sentinel]):
            raise ValueError('Original replay FoW/visibility publications differ')
        return {'enabledInput': enabled, 'nativeCallbackEntry': 0xf03da0, 'nativeStopBeforeGuiRefresh': end,
                'disableByte': disabled, 'visibilityFilterEnabled': filter_bytes[0],
                'selectedSlotByte': filter_bytes[1], 'receiverSelectedSlotFromConstructor': selected,
                'allVisionAction': not enabled}

    for enabled in [False, True, False, True, False]:
        rows.append(action(enabled))
    negative_controls = 0
    for invalid in [None, 0, 1, 2, -1, 'all', 'blue', {}, []]:
        before = bytes(n.u.mem_read(n.base+0x24967c8, 1)) + bytes(n.u.mem_read(n.base+0x255cc88, 2))
        try:
            action(invalid)
        except ValueError as error:
            if str(error) != 'Explicit boolean native FoW action required':
                raise
        else:
            raise ValueError('Unknown perspective input reached native state')
        after = bytes(n.u.mem_read(n.base+0x24967c8, 1)) + bytes(n.u.mem_read(n.base+0x255cc88, 2))
        if before != after:
            raise ValueError('Rejected native action changed visibility state')
        negative_controls += 1
    if bytes(n.u.mem_read(owner, 0x340)).hex() != constructor:
        raise ValueError('Perspective publication unexpectedly mutated original receiver fields')
    blocks = [(0xf0c0f0, 0xf0c114), (0xf010f0, 0xf01720), (0xf03da0, 0xf03e1c),
              (0x21c140, 0x21c171)]
    for file, digest in inputs.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Perspective proof input/source changed: '+file)
    result = {'schema': 1, 'kind': 'original-replay-fow-action-prefix-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'owner': owner, 'constructorHex': constructor,
              'constructorSelectedSlot': selected, 'originalSentinelByte': sentinel,
              'controls': rows, 'negativeControls': negative_controls, 'inputs': inputs,
              'sourceBlocks': [{'rva': start, 'bytes': end-start, 'sha256': sha(n.image[start:end])} for start, end in blocks],
              'originalBlocks': list(n.blocks.values()),
              'scope': {'completeOriginalReceiverFactoryAndConstructor': True,
                        'callbackEntryThroughNativeSetterExecuted': True, 'globalFlagDirectlyAssigned': False,
                        'receiverFieldsDirectlyAssigned': False, 'explicitAllVisionActionProved': True,
                        'blueRedEnumMappingRecovered': False, 'fullGuiRefreshExecuted': False,
                        'recordedPerspectiveRecovered': False, 'nativeFowTextureProduced': False,
                        'fullSceneAdmitted': False}}
    args.output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'controls': len(rows), 'negativeControls': negative_controls,
                      'ownerBytes': n.allocations[owner], 'allVisionDisableByte': rows[0]['disableByte']}))


if __name__ == '__main__':
    main()
