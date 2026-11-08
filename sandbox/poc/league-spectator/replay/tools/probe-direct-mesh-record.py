"""Observe the original static-mesh CPU record, independently of GPU instancing."""
import argparse
import copy
import inspect
import importlib.util
import json
import struct
import sys
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES as A, sha

_spec = importlib.util.spec_from_file_location('direct_mesh_geometry_observer', Path(__file__).with_name('probe-direct-mesh-geometry.py'))
_module = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _module
_spec.loader.exec_module(_module)
NativeMeshGeometry = _module.NativeMeshGeometry


class NativeMeshRecord(NativeMeshGeometry):
    def draw_inputs(self, index, matrix_hex):
        wrapper, scratch = 0x1003c000, 0x1003d000
        pool = self.q(A['actor'] + 0xa0)
        attributes = self.q(pool + 0x98)
        frame = A['stack'] - 0x200
        self.put(frame - 0x38, 'Q', A['link'])
        self.put(frame - 0x30, 'Q', wrapper)
        self.put(frame - 0x60, 'Q', (index + 1) * 0x2c)
        # Execute the caller's atlas construction itself, before its UV setter.
        self.call(0x173e3e7, {r.UC_X86_REG_RBP: frame, r.UC_X86_REG_RSP: A['stack'] - 0x1000,
                              r.UC_X86_REG_R13: attributes, r.UC_X86_REG_R15: 0}, 0x173e4bb)
        atlas = bytes(self.u.mem_read(frame - 0x240, 24))
        self.u.mem_write(A['stack'] + 8, atlas)
        self.call(0x173f190, {r.UC_X86_REG_RDI: wrapper, r.UC_X86_REG_RSI: A['link'],
                              r.UC_X86_REG_RDX: scratch, r.UC_X86_REG_RCX: scratch,
                              r.UC_X86_REG_R8: index, r.UC_X86_REG_R9: scratch}, 0x173f319)
        uv = bytes(self.u.mem_read(self.u.reg_read(r.UC_X86_REG_RDX), 24))
        auxiliary = bytes(self.u.mem_read(self.u.reg_read(r.UC_X86_REG_RCX), 16))
        self.u.mem_write(scratch, uv)
        self.u.mem_write(scratch + 0x20, auxiliary)
        # Original material setter packing, stopping before material lookup.
        self.call(0x17c1800, {r.UC_X86_REG_RDX: scratch, r.UC_X86_REG_RCX: scratch + 0x20}, 0x17c186f)
        packed_uv = bytes(self.u.mem_read(self.u.reg_read(r.UC_X86_REG_RBP) - 0x60, 48))
        self.u.mem_write(scratch + 0x100, bytes.fromhex(matrix_hex))
        self.call(0x1916f70, {r.UC_X86_REG_RSI: scratch + 0x100}, 0x1916fab)
        packed_world = bytes(self.u.mem_read(self.u.reg_read(r.UC_X86_REG_RBP) - 0x60, 64))
        self.call(0x148a7e0, {r.UC_X86_REG_RDI: scratch + 0x100})
        inverse = bytes(self.u.mem_read(self.u.reg_read(r.UC_X86_REG_RAX), 64))
        self.u.mem_write(scratch + 0x100, bytes.fromhex(matrix_hex))
        self.call(0x148baa0, {r.UC_X86_REG_RDI: scratch + 0x100, r.UC_X86_REG_RSI: self.mesh_pointer + 0x40})
        center = (self.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffffffffffff).to_bytes(8, 'little') + (self.u.reg_read(r.UC_X86_REG_XMM1) & 0xffffffff).to_bytes(4, 'little')
        self.call(0x173efd0, {r.UC_X86_REG_RDI: A['link'], r.UC_X86_REG_RSI: scratch,
                              r.UC_X86_REG_XMM0: int.from_bytes(self.u.mem_read(attributes + index * 0x2c + 4, 8), 'little'),
                              r.UC_X86_REG_XMM1: int.from_bytes(self.u.mem_read(attributes + index * 0x2c + 0xc, 8), 'little')}, 0x173f03f)
        color = bytes(self.u.mem_read(self.u.reg_read(r.UC_X86_REG_RDX), 16))
        return {'atlasHex': atlas.hex(), 'composedUvHex': uv.hex(), 'uvAuxiliaryHex': auxiliary.hex(),
                'vParticleUVTransformHex': packed_uv.hex(), 'mWorldHex': packed_world.hex(),
                'rawWorldMatrixHex': matrix_hex,
                'mWorldInvHex': inverse.hex(), 'dynamicMeshCenterHex': center.hex(),
                'kColorFactorHex': color.hex(),
                'materialSetterExecuted': False}

    def record_input(self, index):
        pool = self.q(A['actor'] + 0xa0)
        definition = A['definition']
        primitive = self.q(definition + 0x60)
        if any(self.u.mem_read(primitive + offset, 1)[0] for offset in [0x88, 0x89, 0x8a]):
            raise ValueError('Facing mesh record requires separate original branch')
        uv_flags = [self.u.mem_read(A['link'] + offset, 1)[0] for offset in [0xe8, 0xe9]]
        if any(flag not in [0, 1] for flag in uv_flags):
            raise ValueError('Original UV flags malformed')
        uv_matrices = []
        for flag, offset in zip(uv_flags, [0x78, 0x88]):
            pointer = self.q(pool + offset)
            uv_matrices.append(list(struct.unpack('<6f', self.u.mem_read(pointer + index * 24, 24))) if flag and pointer else None)
        return {'attributesHex': bytes(self.u.mem_read(self.q(pool + 0x98) + index * 0x2c, 0x2c)).hex(),
                'definitionColor': list(struct.unpack('<4f', self.u.mem_read(definition + 0xe0, 16))),
                'textureDivisions': list(struct.unpack('<2f', self.u.mem_read(definition + 0x8c, 8))),
                'blendByte': self.u.mem_read(definition + 0x14, 1)[0],
                'paletteByte': self.u.mem_read(definition + 0xc8, 1)[0],
                'particleIndex': index,
                'facingFlags': [False, False, False], 'linkedUvFlags': [bool(v) for v in uv_flags],
                'linkedUvMatrices': uv_matrices}

    def render_quad(self, view):
        result = super().render_quad(view)
        before = self.snapshot()
        wrapper = 0x1003c000
        frame = A['stack'] - 0x200
        output = frame - 0x330
        records = []
        record_inputs = []
        draw_inputs = []
        for index in range(result['sourceParticleCount']):
            self.u.mem_write(output - 16, bytes([0xa5]) * (176 + 32))
            self.call(0x173e5d0, {
                r.UC_X86_REG_RBX: wrapper,
                r.UC_X86_REG_R14: index,
                r.UC_X86_REG_RCX: 0,
                r.UC_X86_REG_RBP: frame,
                r.UC_X86_REG_RSP: A['stack'] - 0x1000,
            }, 0x173e69a)
            if self.u.reg_read(r.UC_X86_REG_RAX) & 0xff != 1:
                raise ValueError('Original mesh record unresolved')
            if bytes(self.u.mem_read(output - 16, 16)) != bytes([0xa5]) * 16 or bytes(self.u.mem_read(output + 176, 16)) != bytes([0xa5]) * 16:
                raise ValueError('Original mesh record guards changed')
            records.append(bytes(self.u.mem_read(output, 176)).hex())
            record_inputs.append(self.record_input(index))
            draw_inputs.append(self.draw_inputs(index, result['matrixHex'][index]))
        after = self.snapshot()
        changed = [key for key in before if key != 'mathCalls' and before[key] != after[key]]
        if changed:
            raise ValueError(f'Original mesh record mutated particle/RNG state: {changed}')
        result['record176Hex'] = records
        result['recordInputs'] = record_inputs
        result['drawInputs'] = draw_inputs
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    inputs = {}
    def read(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = sha(data)
        return json.loads(data)
    # This source retains the complete unchanged original typed emitter and the
    # resource header independently observed by the original SCB loader.
    inspection = read(cache / 'research/direct-mesh-geometry-inspection.json')
    previous = read(cache / 'research/direct-mesh-geometry-native.json')
    inputs.update(inspection['inputs'])
    inputs.update(previous['inputs'])
    native = NativeMeshRecord(cache / 'public/decoder-16.21-macos', args.client)
    graph = native.prepare_mesh(inspection['state'], bytes.fromhex(previous['mesh']['resourceHeaderHex']))
    classified_graph = copy.deepcopy(graph)
    frame = A['stack'] - 0x100
    native.put(frame - 0x150, 'Q', A['link'])
    native.call(0x16e1d6d, {r.UC_X86_REG_RAX: A['definition'], r.UC_X86_REG_R15: A['link'], r.UC_X86_REG_RBP: frame}, 0x16e1dbe)
    classified_flags = list(native.u.mem_read(A['link'] + 0xe8, 2))
    if classified_flags != [1, 0]:
        raise ValueError('Actual Hecarim15 authored UV classification differs')
    classified_graph['segments'][0]['bytesHex'] = bytes(native.u.mem_read(A['definition'], 0x10000)).hex()
    cases = []
    for mode, selected_graph in [('unbound', graph), ('original-authored-uv', classified_graph)]:
        for case in previous['cases']:
            native.reset_quad(selected_graph, int(case['seedHex'], 16), 0)
            frames = []
            for frame in case['frames']:
                value = frame['input']
                frames.append({'input': value, 'output': native.frame_quad(value)})
            cases.append({**{k: v for k, v in case.items() if k != 'frames'}, 'uvMode': mode, 'frames': frames})
    leaf_controls = []
    for frame, divisions, blend, palette in [
        (0, [1, 1], 0, 0), (5.75, [4, 2], 0, 3),
        (-3.25, [4, 2], 2, 4), (7, [3, 5], 1, 5),
        (2, [0, 1], 3, 1), (2, [1, 0], 4, 2),
        (100, [7, 3], 5, 255), (-17, [7, 3], 6, 0),
    ]:
        native.reset_quad(graph, 1, 0)
        native.frame_quad(previous['cases'][0]['frames'][0]['input'])
        attributes = native.q(native.q(A['actor'] + 0xa0) + 0x98)
        native.put(attributes, 'f', frame)
        native.put(attributes + 4, '4f', .25, .5, .75, .375)
        native.put(A['definition'] + 0xe0, '4f', .5, .75, .25, .875)
        native.put(A['definition'] + 0x8c, '2f', *divisions)
        native.put(A['definition'] + 0x14, 'B', blend)
        native.put(A['definition'] + 0xc8, 'B', palette)
        geometry = native.render_quad([300, 900, 1200])
        leaf_controls.append({'input': geometry['recordInputs'][0],
                              'matrixHex': geometry['matrixHex'][0],
                              'recordHex': geometry['record176Hex'][0]})
    for source in {Path(__file__), Path(__file__).with_name('probe-direct-mesh-geometry.py'), *[Path(inspect.getfile(c)) for c in type(native).__mro__ if c is not object]}:
        inputs[str(source.resolve())] = sha(source.read_bytes())
    for path, expected in inputs.items():
        if sha(Path(path).read_bytes()) != expected:
            raise ValueError(f'Consumed input changed: {path}')
    report = {'schema': 1, 'kind': 'original-static-mesh-cpu-record-controls',
              'build': previous['build'], 'protocol': previous['protocol'],
              'decoderImageSha256': previous['decoderImageSha256'],
              'effectId': previous['effectId'], 'emitterIndex': previous['emitterIndex'],
              'recordBytes': 176, 'cases': cases, 'suppliedLeafControls': leaf_controls,
              'authoredUvClassification': {'flags': classified_flags, 'originalRange': [0x16e1d6d, 0x16e1dbe]},
              'originalBlocks': list(native.blocks.values()), 'inputs': inputs,
              'scope': {'originalRecordTemplateAndWriterExecuted': True,
                        'originalTemplateRange': [0x173e5d0, 0x173e69a],
                        'originalRecordWriter': 0x173cb70,
                        'suppliedClockPoseAndSeed': True,
                        'unboundAndOriginalAuthoredUvComparedSeparately': True,
                        'originalMatrixSetterPackingPrefix': [0x1916f70, 0x1916fab],
                        'dx11Instance208BytePackingEstablished': False,
                        'gpuDrawSubmitted': False, 'runtimeIntegrated': False,
                        'nativeAcceptance': None}}
    output = cache / 'research/direct-mesh-record-native.json'
    output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases),
                      'frames': sum(len(c['frames']) for c in cases),
                      'records': sum(len(f['output']['geometry']['record176Hex']) for c in cases for f in c['frames']),
                      'inputs': len(inputs)}))


if __name__ == '__main__':
    main()
