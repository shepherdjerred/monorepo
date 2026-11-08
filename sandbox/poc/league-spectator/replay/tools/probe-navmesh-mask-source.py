"""Observe the original loaded navgrid CPU RGBA surface; no mask admission."""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from character_script_native import NativeCharacterScripts
from native_ai_unit_fixture import NativeAIUnitFixture
from navgrid_world_native import NativeNavgridStream, initialize_navgrid_world
from vfx_spawn_native import sha


class Control(NativeNavgridStream, NativeCharacterScripts):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    decoder = fixture.cache / 'public/decoder-16.21-macos'
    paths = {Path(__file__), args.client, decoder / 'profile.json', decoder / 'image.bin',
             Path(inspect.getfile(type(n.source))), Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(initialize_navgrid_world)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    source_inputs_before = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    result, observation, boundary = None, None, None
    try:
        # Independent immediate-only ARGB startup block. The existing math
        # fixture stops before these globals. No cell or RGBA byte is supplied.
        constants_before = bytes(n.u.mem_read(n.base + 0x256cbb0, 12)).hex()
        n.call(0x14aa563, {}, 0x14aa5f9)
        constants_after = bytes(n.u.mem_read(n.base + 0x256cbb0, 12)).hex()
        if constants_after != 'ffffffff00000000000000ff':
            raise ValueError('Original scalar ARGB constants differ')
        result = initialize_navgrid_world(fixture)
        runtime = result['runtime']
        n.call(0x16adc30, {})
        if n.u.reg_read(r.UC_X86_REG_RAX) != runtime:
            raise ValueError('Original active-navgrid getter identity differs')
        pointer = n.q(runtime + 0x5b0)
        width, height = struct.unpack('<II', n.u.mem_read(runtime + 0x6d8, 8))
        dirty = n.u.mem_read(runtime + 0x5b8, 1)[0]
        # Execute the complete original scene producer, including its active
        # runtime lookup, both vector getters, and the uniform-global setter.
        from vfx_spawn_native import ADDRESSES as A
        frame = A['stack'] - 0x200
        n.u.mem_write(frame - 0x180, bytes([0xa5]) * 0x180)
        transform_before = bytes(n.u.mem_read(n.base + 0x2549030, 16)).hex()
        n.call(0x60c8fb, {r.UC_X86_REG_RBP: frame, r.UC_X86_REG_RSP: frame - 0x200}, 0x60c940)
        transform_after = bytes(n.u.mem_read(n.base + 0x2549030, 16)).hex()
        scene_transform = {'producerStartRva': 0x60c8fb, 'producerEndRva': 0x60c940,
                           'setterRva': 0x182bfc0, 'globalRva': 0x2549030,
                           'beforeHex': transform_before, 'afterHex': transform_after,
                           'center': list(struct.unpack('<3f', n.u.mem_read(frame - 0x148, 12))),
                           'extent': list(struct.unpack('<3f', n.u.mem_read(frame - 0x160, 12))),
                           'runtimeCellSize': struct.unpack('<f', n.u.mem_read(runtime + 0x6e0, 4))[0],
                           'runtimeOrigin': list(struct.unpack('<3f', n.u.mem_read(runtime + 0xbc, 12))),
                           'values': list(struct.unpack('<4f', bytes.fromhex(transform_after))),
                           'originalGlobalStoreExecuted': True, 'gpuUploadExecuted': False}
        observation = {'runtime': runtime, 'rgbaPointer': pointer,
                       'width': width, 'height': height, 'dirtyByte': dirty,
                       'allocationBytes': n.allocations.get(pointer), 'sceneTransform': scene_transform,
                       'originalArgbInitialization': {'startRva': 0x14aa563, 'endRva': 0x14aa5f9,
                                                      'beforeHex': constants_before, 'afterHex': constants_after,
                                                      'sha256': sha(n.image[0x14aa563:0x14aa5f9])}}
        if not pointer or not 1 <= width <= 4096 or not 1 <= height <= 4096:
            observation['status'] = 'original-loader-has-no-bounded-rgba-surface'
        elif not n.writable_file_memory(pointer, width * height * 4):
            raise ValueError('Original RGBA surface escapes owned runtime memory')
        else:
            rgba = bytes(n.u.mem_read(pointer, width * height * 4))
            cells = n.q(runtime + 0xe0)
            if not n.writable_file_memory(cells, width * height * 16):
                raise ValueError('Original cell flags escape owned runtime memory')
            cell_bytes = bytes(n.u.mem_read(cells, width * height * 16))
            flags = bytearray()
            for i in range(width * height):
                cell_pointer = struct.unpack_from('<Q', cell_bytes, i * 16)[0]
                if cell_pointer:
                    raise ValueError('Dynamic cell overlay requires separate producer proof')
                value = struct.unpack_from('<H', cell_bytes, i * 16 + 8)[0]
                flags.extend(struct.pack('<H', value))
                expected = bytes.fromhex('000000ff' if value & 0xc02 == 2 else 'ffffffff')
                if rgba[i * 4:i * 4 + 4] != expected:
                    raise ValueError(f'Original initial flag-derived RGBA differs at cell {i}')
            observation.update(status='owned-original-cpu-rgba-surface', bytes=len(rgba),
                               sha256=sha(rgba), first64Hex=rgba[:64].hex(),
                               rgbaHex=rgba.hex(), baseCellFlagsHex=flags.hex(),
                               initialCellFlagsCompared=width * height,
                               blueHistogram={str(value): rgba[2::4].count(value) for value in sorted(set(rgba[2::4]))})
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    inputs = dict(fixture.inputs)
    inputs.update(source_inputs_before)
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Original navmesh CPU source input changed during execution')
    report = {'schema': 1, 'kind': 'original-navmesh-mask-cpu-source-observation',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'loader': result, 'observation': observation,
              'boundary': boundary, 'inputs': inputs, 'originalBlocks': list(n.blocks.values()),
              'scope': {'researchSelectedMap12Base': True, 'decodedMapVariantSelection': False,
                        'suppliedReadinessOrRgbaBytes': False, 'textureUploadExecuted': False,
                        'originalLoadedSceneTransformProducerExecuted': observation is not None,
                        'sceneTransformUploadedToGpu': False, 'runtimeAdmissionChanged': False}}
    output = fixture.cache / 'research/navmesh-mask-source-native.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'observation': observation, 'boundary': boundary}))
    if boundary: raise SystemExit(1)


if __name__ == '__main__': main()
