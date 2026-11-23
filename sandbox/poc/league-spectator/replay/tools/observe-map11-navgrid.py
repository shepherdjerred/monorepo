"""Execute the complete original navgrid loader on the exact archived Map11 bytes.

The optional live map owner remains absent. This proves source parsing, origin
and heights; collision queries, runtime world routing and readiness of replay
entities remain separate.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from navgrid_world_native import NativeNavgridStream
from wad_file_native import NativeWadFiles
from vfx_spawn_native import ADDRESSES, sha


class Control(NativeNavgridStream, NativeWadFiles):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'scene', 'navgrid', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    manifest_bytes = (args.scene/'manifest.json').read_bytes()
    scene = json.loads(manifest_bytes)
    data = args.navgrid.read_bytes()
    heights = (args.scene/'heights.bin').read_bytes()
    if (scene['build'] != '16.21.829.8620' or scene['protocol'] != '20e09df23c66b85e' or
            scene['map']['id'] != 11 or scene['map']['navPath'] != 'ASSETS/Maps/NavGrid/Map11/AIPath_SRX_3.aimesh_ngrid' or
            sha(data) != scene['map']['heightGrid']['sourceSha256']):
        raise ValueError('Exact archived Map11 navgrid and prepared scene required')
    height_files = [entry for entry in scene['files'] if entry['path'] == 'heights.bin']
    if len(height_files) != 1 or height_files[0]['sha256'] != sha(heights) or height_files[0]['bytes'] != len(heights):
        raise ValueError('Closed original height inventory required')
    n = Control(args.cache/'public/decoder-16.21-macos', args.client)
    if sha(n.image) != n.profile['decoderImageSha256']:
        raise ValueError('Original navgrid image identity differs')
    result, boundary = None, None
    slices = []
    try:
        if n.q(n.base+0x246c948):
            raise ValueError('Original navgrid manager must be cold')
        stream = n.open_navgrid_stream(data)
        manager = n.allocate(0x130)
        n.u.mem_write(manager+0x30, b'\xa5'*0x100)
        n.call(0x16b3670, {r.UC_X86_REG_RDI: manager})
        if n.q(n.base+0x246c948) != manager or n.q(manager+8):
            raise ValueError('Original manager publication or empty data differs')
        n.call(0x16b9530, {})
        if n.u.reg_read(r.UC_X86_REG_RAX) & 0xff:
            raise ValueError('Original navgrid is ready before loading')
        n.u.context_restore(n.initial)
        n.put(ADDRESSES['stack'], 'Q', ADDRESSES['stop'])
        for register, value in {r.UC_X86_REG_RSP: ADDRESSES['stack'], r.UC_X86_REG_RDI: manager,
                                r.UC_X86_REG_RSI: 0, r.UC_X86_REG_RDX: stream}.items():
            n.u.reg_write(register, value)
        start = n.base+0x16b6ef0
        for index in range(64):
            n.u.emu_start(start, ADDRESSES['stop'], count=5000000)
            start = n.u.reg_read(r.UC_X86_REG_RIP)
            slices.append({'index': index+1, 'instructionBound': 5000000,
                           'streamPosition': n.navgrid_stream['position'], 'stop': start})
            if start == ADDRESSES['stop']:
                break
        else:
            raise ValueError('Original loader exceeded sixty-four bounded instruction slices')
        runtime = n.q(manager+8)
        if n.allocations.get(runtime) != 0x708 or n.q(runtime+0x6f0) != manager or n.q(runtime+0x6f8):
            raise ValueError('Original navgrid allocation/manager/absent owner differs')
        dimensions = list(struct.unpack('<IIff', n.u.mem_read(runtime+0x100, 16)))
        grid = scene['map']['heightGrid']
        if dimensions != [grid['x'], grid['z'], *grid['step']]:
            raise ValueError('Original loaded dimensions differ from prepared Map11')
        pointer = n.q(runtime+0xf8)
        if bytes(n.u.mem_read(pointer, len(heights))) != heights:
            raise ValueError('Complete original loaded heights differ from prepared Map11')
        n.call(0x16b9530, {})
        if (n.u.reg_read(r.UC_X86_REG_RAX) & 0xff) != 1:
            raise ValueError('Original navgrid is not ready after complete load')
        if bytes(n.u.mem_read(manager+0x30, 0x100)) != b'\xa5'*0x100:
            raise ValueError('Original manager escaped its guarded allocation')
        result = {'manager': manager, 'runtime': runtime, 'dimensions': dimensions,
                  'sourcePosition': n.navgrid_stream['position'], 'sourceBytes': len(data),
                  'heightsMatch': True, 'heightBytes': len(heights),
                  'originalReadyPredicateBeforeLoad': False, 'originalReadyPredicateAfterLoad': True,
                  'managerGuardIntact': True, 'ownerContextInput': None}
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls not in [object, Control]]}
    output = {'schema': 1, 'kind': 'complete-original-map11-navgrid-load',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'sceneManifestSha256': sha(manifest_bytes),
              'navgridSha256': sha(data), 'heightsSha256': sha(heights),
              'sources': {str(path.resolve()): sha(path.read_bytes()) for path in sorted(paths)},
              'result': result, 'boundary': boundary, 'slices': slices,
              'originalBlocks': list(n.blocks.values()),
              'scope': {'completeOriginalNavgridLoad': result is not None, 'readinessBitsSupplied': False,
                        'liveMapOwnerRecovered': False, 'collisionQueriesVerified': False,
                        'acceptedReplayEntities': False, 'nativeSpectatorEquivalent': False}}
    args.output.write_text(json.dumps(output, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'result': result, 'boundary': boundary}), flush=True)
    if hasattr(n, 'close_files'):
        n.close_files()
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
