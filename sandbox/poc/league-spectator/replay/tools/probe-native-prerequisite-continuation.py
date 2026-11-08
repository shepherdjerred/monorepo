"""Original unit-collection caller: deliberate stop/init/resume versus cold order."""
import argparse
import inspect
import json
from pathlib import Path
import capstone
import unicorn
from unicorn import x86_const as r
from aligned_asset_memory_native import AlignedAssetMemory
from game_mode_data_native import NativeGameModeData
from native_ai_unit_fixture import NativeAIUnitFixture
from native_prerequisite_continuation import NativePrerequisiteContinuation
from unit_collection_native import initialize_unit_collection
from vfx_spawn_native import ADDRESSES, sha


class Control(AlignedAssetMemory, NativeGameModeData):
    pass


def fail_after_original_initializer(n):
    initialize_unit_collection(n)
    raise ValueError('Explicit control failure after original publication')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    inputs = {}
    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Continuation control input drift: ' + str(path))
        inputs[str(path)] = digest
        return data
    source_paths = {Path(__file__).resolve(), Path(inspect.getfile(NativePrerequisiteContinuation)).resolve(),
                    Path(inspect.getfile(initialize_unit_collection)).resolve(),
                    Path(inspect.getfile(NativeAIUnitFixture)).resolve(),
                    *[Path(inspect.getfile(c)).resolve() for c in Control.__mro__ if c is not object]}
    source_pins = {str(path): sha(raw(path)) for path in source_paths}
    proof_path = args.cache / 'research/unit-collection-native.json'
    proof_hash = sha(raw(proof_path))
    def fixture():
        result = NativeAIUnitFixture(args.cache, args.client, Control)
        for path, digest in result.inputs.items():
            if sha(raw(path)) != digest:
                raise ValueError('Fixture input changed')
        return result.native
    def opaque(n):
        return n.allocate(8)
    def call(n, pointer):
        n.call(0xc0980, {r.UC_X86_REG_R14:pointer, r.UC_X86_REG_RSP:ADDRESSES['stack']-8}, 0xc0ab3)
    # Discover an actual missing-global load in a disposable cold control.
    fault = fixture()
    pointer = opaque(fault)
    try:
        call(fault, pointer)
    except unicorn.UcError as error:
        if error.errno != unicorn.UC_ERR_READ_UNMAPPED:
            raise
    else:
        raise ValueError('Expected missing unit-collection scalar read did not fault')
    fault_at = fault.u.reg_read(r.UC_X86_REG_RIP)-fault.base
    # Restoring a CPU which already cached NULL in R15 cannot be repaired by
    # publishing the singleton. Stop before the original global load instead;
    # do not patch R15 or silently rewind an already failed instruction stream.
    if fault_at != 0xc0987:
        raise ValueError('Expected cached-null scalar fault differs')
    at = 0xc0980
    disassembler=capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    disassembler.detail=True
    instruction=next(disassembler.disasm(bytes(fault.source.image[at:at+15]),at))
    if (instruction.mnemonic!='mov' or instruction.op_str.split(',')[0]!='r15' or
            instruction.operands[1].mem.base!=r.UC_X86_REG_RIP or
            instruction.address+instruction.size+instruction.operands[1].mem.disp != 0x246c938):
        raise ValueError('Original singleton-load boundary differs')
    boundary = {'rva':at,'size':instruction.size,'sha256':sha(bytes(fault.source.image[at:at+instruction.size]))}
    def arm(n, initializer=initialize_unit_collection, more=None):
        options = dict(boundary=boundary, stack_start=0x10001000, stack_size=0x10000,
            initializer=initializer, source_pins=source_pins, proof_path=proof_path,
            proof_sha256=proof_hash, required_zero_globals=[0x246c938])
        options.update(more or {})
        return NativePrerequisiteContinuation(n, **options)
    def pause(n, control, pointer):
        try:
            call(n, pointer)
        except ValueError:
            if control.state != 'paused-before-instruction':
                raise
        else:
            raise ValueError('A pre-instruction pause unexpectedly completed its caller')
    resumed = fixture()
    pointer = opaque(resumed)
    control = arm(resumed)
    rejects = 0
    try:
        control.resume(resumed.base+0xc0ab3)
    except ValueError:
        rejects += 1
    pause(resumed, control, pointer)
    record = control.initialize()
    control.resume(resumed.base+0xc0ab3)
    if record['stop'] != record['expectedStop']:
        raise ValueError('Continued original insertion did not complete')
    try:
        control.resume(resumed.base+0xc0ab3)
    except ValueError:
        rejects += 1
    def outcome(n):
        owner=n.q(n.base+0x246c938)
        return {'nextHeap':n.next_heap,'allocations':n.allocations,
                'heapSha256':sha(bytes(n.u.mem_read(0x10400000,n.next_heap-0x10400000))),
                'owner':owner,'count':n.u32(owner+0x10),
                'items':[n.q(n.q(owner+8)+i*8) for i in range(n.u32(owner+0x10))],
                'blocks':sorted(n.blocks.values(),key=lambda row:row['rva'])}
    cold = fixture()
    cold_pointer = opaque(cold)
    initialize_unit_collection(cold)
    call(cold,cold_pointer)
    if outcome(cold) != outcome(resumed):
        raise ValueError('Debug continuation differs from independently cold-ordered control')
    failed = fixture()
    failed_pointer = opaque(failed)
    failed_control = arm(failed, fail_after_original_initializer)
    pause(failed,failed_control,failed_pointer)
    cpu_before=failed.u.context_save()
    stack_before=bytes(failed.u.mem_read(0x10001000,0x10000))
    try:
        failed_control.initialize()
    except ValueError as error:
        if 'Explicit control failure' not in str(error):
            raise
    else:
        raise ValueError('Failed initializer unexpectedly admitted continuation')
    if (failed_control.state != 'tainted-initializer-failure' or
            not failed.q(failed.base+0x246c938) or
            any(failed.u.reg_read(register) != cpu_before.reg_read(register) for register in
                [r.UC_X86_REG_RIP,r.UC_X86_REG_RSP,r.UC_X86_REG_R15,r.UC_X86_REG_EFLAGS,r.UC_X86_REG_XMM0]) or
            bytes(failed.u.mem_read(0x10001000,0x10000)) != stack_before):
        raise ValueError('Failure did not retain heap/global effects and restore only CPU/stack')
    try:
        failed_control.resume(failed.base+0xc0ab3)
    except ValueError:
        rejects += 1
    for bad in [dict(boundary={**boundary,'sha256':'0'*64}), dict(stack_start=0x10400000),
                dict(proof_sha256='0'*64), dict(source_pins={})]:
        n=fixture()
        try:
            unexpected=arm(n,more=bad)
        except ValueError:
            rejects += 1
        else:
            unexpected.close()
            raise ValueError('Invalid continuation ownership/provenance admitted')
    for path,digest in list(inputs.items()):
        if sha(raw(path)) != digest:
            raise ValueError('Continuation control input changed')
    output=args.cache/'research/native-prerequisite-continuation-control.json'
    result={'schema':1,'build':resumed.profile['clientVersion'],
        'decoderImageSha256':resumed.profile['decoderImageSha256'],
        'kind':'dev-only-original-prerequisite-continuation-control', 'inputs':inputs,
        'boundary':{**boundary,'instruction':instruction.mnemonic+' '+instruction.op_str,
                    'laterCachedNullFaultRva':fault_at,'pauseBeforeSingletonLoad':True,
                    'arbitraryFaultRecoverySupported':False},
        'continuation':record,'independentColdOutcomeEqual':True,'coldOutcome':outcome(cold),
        'failureRestoredOnlyCpuAndStackAndForbadeResume':True,'rejectControls':rejects,
        'scope':{'originalCallerAndInitializerExecuted':True,'fullHeroBootstrapExecuted':False,
                 'heapOrProcessSnapshotByContinuation':False,'instructionOrCallbackReplaced':False,
                 'outOfOrderDebugEvidence':True,'requiresFinalColdMainRun':True,
                 'resourceOrReplayAcceptanceEstablished':False}}
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'independentColdOutcomeEqual':True,'rejectControls':rejects,'fingerprints':len(inputs)}))


if __name__=='__main__':
    main()
