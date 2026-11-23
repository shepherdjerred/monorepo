"""Original compressed ANM evaluation on explicit archived bytes and original rig.

Function-scoped resource construction/binding/evaluation only. The raw archived
payload is supplied in owned memory; no archive loader or complete match runs.
"""
import argparse
import inspect
import json
import math
import sys
from pathlib import Path
import struct
from unicorn import x86_const as r
from animation_world_pose_native import NativeAnimationWorldPose
from animation_clock_native import NativeAnimationClock
from animation_rig_native import RIG
from vfx_spawn_native import sha
from animation_runtime_identity import animation_runtime_identity


class NativeArchivedAnimation(NativeAnimationWorldPose, NativeAnimationClock):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['package', 'client', 'actor', 'diagnostics', 'output']:
        parser.add_argument(key, type=Path)
    parser.add_argument('--source', required=True)
    parser.add_argument('--all-frames', action='store_true')
    parser.add_argument('--clip-output', type=Path)
    args = parser.parse_args()
    inputs = {}

    def raw(file):
        data = Path(file).read_bytes()
        inputs[str(Path(file).resolve())] = sha(data)
        return data

    report = json.loads(raw(args.diagnostics))
    selected = json.loads(raw(args.actor/'selected-clips.json'))
    if args.source not in selected.values():
        raise ValueError('Explicit selected original animation file required')
    source_path = (args.actor/args.source).resolve()
    if not source_path.is_relative_to(args.actor.resolve()):
        raise ValueError('Original animation path escaped actor input')
    source = raw(source_path)
    reference = next(row for row in report['records'] if row['file'] == args.source)
    if sha(source) != reference['sourceSha256'] or source[:8] != b'r3d2canm' or struct.unpack_from('<I', source, 8)[0] != 1:
        raise ValueError('Exact original compressed source identity required')
    rig = raw(args.actor/'model.skl')
    if sha(rig) != report['rigSha256']:
        raise ValueError('Exact original skeleton identity required')
    n = NativeArchivedAnimation(args.package, args.client)
    result = {'schema': 1, 'kind': 'original-archived-compressed-animation-probe', 'build': n.profile['clientVersion'],
              'sourceSha256': sha(source), 'rigSha256': sha(rig), 'sourceFile': args.source,
              'runtime': animation_runtime_identity(),
              'boundary': None, 'samples': [], 'scope': {'originalResourceConstructor': True,
                'originalRigBinding': True, 'originalCacheConstructor': True, 'originalEvaluator': True,
                'archiveLoaderExecuted': False, 'completeActorExecuted': False, 'nativeFidelityAdmission': False}}
    phase = 'rig-construction'
    try:
        # This original static block publishes the vector/identity-quaternion
        # constants used by missing compressed channels. Cold BSS is not a
        # valid substitute for the client's initialized mathematics library.
        n.call(0x14aa41b, {}, 0x14aa516)
        result['mathConstants'] = {'originalBlock': [0x14aa41b, 0x14aa516],
          'rotationIdentityHex': bytes(n.u.mem_read(n.base+0x256ca80, 16)).hex(),
          'scaleIdentityHex': bytes(n.u.mem_read(n.base+0x256cb28, 12)).hex()}
        prepared_rig = n.prepare(rig, report['rigJoints'])
        result['rigJointsOriginal'] = prepared_rig['joints']
        if any(joint['nativePoseIndex'] != index for index, joint in enumerate(prepared_rig['joints'])):
            raise ValueError('Original rig requires an explicit pose-index permutation')
        rig_rows = n.q(RIG+0x28)
        result['bindLocalPosesHex'] = [bytes(n.u.mem_read(rig_rows+index*0x70+0x20, 40)).hex() for index in range(len(report['rigJoints']))]
        # Execute the original static null-offset initialization used by the
        # compressed evaluator, rather than interpreting cold BSS zero as null.
        n.call(0x15dcd0e, {}, 0x15dcd18)
        phase = 'compressed-resource-construction'
        raw_pointer = 0x10100000
        if not 0x80 <= len(source) < 0x100000:
            raise ValueError('Original compressed resource exceeds owned raw bounds')
        n.u.mem_write(raw_pointer, source)
        resource = n.allocate(0x70)
        n.call(0x15b08e0, {r.UC_X86_REG_RDI: resource, r.UC_X86_REG_RSI: raw_pointer+12})
        if n.q(resource) != n.base+0x23e3950:
            raise ValueError('Original resource constructor class differs')
        n.call(0x15bf960, {r.UC_X86_REG_RDI: resource})
        frames = n.u.reg_read(r.UC_X86_REG_EAX)
        n.call(0x15bf940, {r.UC_X86_REG_RDI: resource})
        fps = struct.unpack('<f', struct.pack('<I', n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff))[0]
        if not 1 <= frames <= 100000 or not math.isfinite(fps) or fps <= 0:
            raise ValueError('Original resource timing exceeds bounds')
        count = len(report['rigJoints'])
        mapping = n.allocate(16)
        indices = n.allocate(count*4)
        n.put(mapping, 'QII', indices, count, count)
        phase = 'original-rig-binding'
        n.call(0x15b3120, {r.UC_X86_REG_RDI: resource, r.UC_X86_REG_RSI: RIG, r.UC_X86_REG_RDX: mapping})
        bound = list(struct.unpack('<'+'i'*count, n.u.mem_read(indices, count*4)))
        tracks = struct.unpack('<I', n.u.mem_read(resource+0x1c, 4))[0]
        if any(index < -1 or index >= tracks for index in bound):
            raise ValueError('Original rig binding exceeds track count')
        result.update(resourceFrames=frames, resourceFps=fps, trackIndices=bound,
                      resourceHeaderHex=bytes(n.u.mem_read(resource, 0x70)).hex())
        phase = 'cache-construction'
        owner = n.allocate(0x170)
        n.u.mem_write(owner+0x70, b'\xa5'*0x100)
        n.call(0x15889f8, {r.UC_X86_REG_RDI: owner}, 0x1588a19)
        cache = owner+0x58
        if bytes(n.u.mem_read(cache, 24)) != struct.pack('<fI QII', -1, 0, 0, 0, 0):
            raise ValueError('Original compressed cache constructor differs')
        duration = (frames-1)/fps
        times = [index/fps for index in range(frames)] if args.all_frames else [0, 1/fps, duration/2, duration]
        rewind_index = len(times)
        times.extend([0, .5/fps])
        for time in times:
            phase = 'original-pose-evaluation'
            pose = n.allocate(0x210)
            n.u.mem_write(pose+0x110, b'\xa5'*0x100)
            n.call(0x15bc970, {r.UC_X86_REG_RDI: pose, r.UC_X86_REG_RSI: RIG})
            if not result['samples']:
                weights = n.q(pose+0x38)
                result['poseWeightsAtZero'] = list(struct.unpack('<'+'f'*count, n.u.mem_read(weights, count*4)))
            encoded = struct.pack('<f', time)
            n.call(0x15b0b30, {r.UC_X86_REG_RDI: resource, r.UC_X86_REG_RSI: pose,
                r.UC_X86_REG_RDX: mapping, r.UC_X86_REG_RCX: cache,
                r.UC_X86_REG_XMM0: int.from_bytes(encoded, 'little')})
            if not n.u.reg_read(r.UC_X86_REG_AL):
                raise ValueError('Original compressed evaluator rejected source')
            output = n.q(pose+8)
            if not 0x10400000 <= output <= output+count*40 <= n.next_heap:
                raise ValueError('Original pose escaped owned allocation bounds')
            data = bytes(n.u.mem_read(output, count*40))
            if not all(math.isfinite(value) for value in struct.unpack('<'+'f'*(count*10), data)):
                raise ValueError('Original evaluator produced non-finite pose values')
            if bytes(n.u.mem_read(pose+0x110, 0x100)) != b'\xa5'*0x100 or bytes(n.u.mem_read(owner+0x70, 0x100)) != b'\xa5'*0x100:
                raise ValueError('Original compressed evaluator changed owned guards')
            result['samples'].append({'time': struct.unpack('<f', encoded)[0], 'localPosesHex': data.hex(), 'finite': True})
            if len(result['samples']) == 1:
                states = n.q(cache+8)
                if n.allocations.get(states) != tracks*0xb8:
                    raise ValueError('Original compressed cache allocation size differs')
                result['cacheAtZero'] = {'trackCount': tracks, 'bytesPerTrack': 0xb8,
                                         'statesHex': bytes(n.u.mem_read(states, tracks*0xb8)).hex()}
            if len(result['samples']) == 2:
                result['cacheAtNextFrame'] = {'time': struct.unpack('<f', encoded)[0], 'cursor': struct.unpack('<I', n.u.mem_read(cache+4, 4))[0],
                    'statesHex': bytes(n.u.mem_read(n.q(cache+8), tracks*0xb8)).hex()}
        if result['samples'][0]['localPosesHex'] != result['samples'][rewind_index]['localPosesHex']:
            raise ValueError('Original rewind failed to reproduce zero-time pose')
        if args.clip_output:
            if not args.all_frames or args.clip_output.resolve().is_relative_to(args.actor.resolve()):
                raise ValueError('Native clip output requires complete frames and an isolated output path')
            samples = [bytes.fromhex(sample['localPosesHex']) for sample in result['samples'][:frames]]
            data = bytearray()
            tracks = []
            for joint, bone in enumerate(report['rigJoints']):
                if bound[joint] < 0:
                    continue
                for channel, first, width in [('position', 0, 3), ('scale', 3, 3), ('quaternion', 6, 4)]:
                    values = [sample[joint*40+first*4:joint*40+(first+width)*4] for sample in samples]
                    constant = all(value == values[0] for value in values)
                    offset = len(data)
                    data.extend(b''.join(values[:1] if constant else values))
                    tracks.append({'jointId': joint, 'bone': bone, 'channel': channel, 'width': width, 'count': 1 if constant else frames, 'offset': offset})
            original_duration = struct.unpack('<f', n.u.mem_read(resource+0x28, 4))[0]
            header = json.dumps({'schema': 1, 'duration': original_duration, 'fps': fps, 'frames': frames, 'tracks': tracks}, separators=(',', ':')).encode()
            encoded = struct.pack('<I', len(header))+header+data
            args.clip_output.parent.mkdir(parents=True, exist_ok=True)
            args.clip_output.write_bytes(encoded)
            result['nativeClip'] = {'path': str(args.clip_output.resolve()), 'sha256': sha(encoded), 'frames': frames, 'tracks': len(tracks), 'duration': original_duration, 'fps': fps}
    except Exception as error:
        result['boundary'] = {'phase': phase, 'kind': type(error).__name__, 'message': str(error), 'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    for file in [args.package/'profile.json', args.package/'image.bin', args.client]:
        raw(file)
    # Include locally imported helpers as well as inherited classes. A function
    # imported from macho.py must invalidate the export just like an MRO method.
    root = Path(__file__).resolve().parent
    sources = {Path(__file__), *[Path(inspect.getfile(base)) for base in NativeArchivedAnimation.__mro__ if base is not object]}
    sources.update(Path(module.__file__) for module in tuple(sys.modules.values())
                   if getattr(module, '__file__', None) and Path(module.__file__).resolve().parent == root)
    result.update(inputs=inputs, sources={str(file.resolve()): sha(raw(file)) for file in sources}, originalBlocks=list(n.blocks.values()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'samples': len(result['samples']), 'boundary': result['boundary']}))
    if result['boundary'] is not None:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
