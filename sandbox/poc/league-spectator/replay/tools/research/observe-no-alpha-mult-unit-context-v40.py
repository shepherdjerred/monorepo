"""Read back the explicit numerical harness context, without changing assets."""
import hashlib
import inspect
import json
import struct
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[6]
TOOLS = ROOT / 'sandbox/poc/league-spectator/replay/tools'
sys.path.insert(0, str(TOOLS))
from vfx_bound_quad_native import NativeBoundQuad
from vfx_spawn_native import ADDRESSES as A
inputs = {}
def raw(path):
    path = Path(path).resolve(); data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if str(path) in inputs and inputs[str(path)] != digest:
        raise ValueError('Native context input drift')
    inputs[str(path)] = digest
    return data
def read(path): return json.loads(raw(path))
original = read(ROOT / '.cache/replay-spike/research/no-alpha-mult-stream-raster-v40.json')
n = NativeBoundQuad(ROOT / '.cache/replay-spike/public/decoder-16.21-macos', ROOT / '.cache/replay-spike/research/LeagueofLegends-macos')
rows = []
for row in original['rows']:
    assets = ROOT / '.cache' / row['cache'] / 'public'
    material = read(assets.parent / 'research/vfx-materials-native.json')
    observation = next(value for value in material['emitters'] if f"{value['effectId']}:{value['emitterIndex']}" == row['materialKey'])
    graph = read(assets / 'decoder-16.21-macos' / observation['graphFile'])
    metadata = read(assets / 'decoder-16.21-macos/vfx-bound-quads.json')
    n.reset_bound(graph, 1, 0, metadata)
    values = []
    for frame in row['frames'][:2]:
        n.frame_bound(frame['input'])
        parent = bytes(n.u.mem_read(A['system'] + 0x1cc, 4))
        factor = bytes(n.u.mem_read(A['actor'] + 0xb0, 4))
        values.append({'time': frame['input']['time'], 'parentBoundObjectSizeHex': parent.hex(), 'parentBoundObjectSize': struct.unpack('<f', parent)[0], 'componentCurrentFlexFactorHex': factor.hex(), 'componentCurrentFlexFactor': struct.unpack('<f', factor)[0]})
    if any(value['parentBoundObjectSize'] != 1 for value in values):
        raise ValueError('Original explicit unit bound-size harness changed')
    rows.append({'materialKey': row['materialKey'], 'values': values})
for module in tuple(sys.modules.values()):
    path = getattr(module, '__file__', None)
    if path and Path(path).suffix == '.py' and Path(path).resolve().is_relative_to(TOOLS): raw(path)
for path in [Path(__file__), ROOT / '.cache/replay-spike/research/LeagueofLegends-macos', ROOT / '.cache/replay-spike/public/decoder-16.21-macos/image.bin']: raw(path)
output = ROOT / '.cache/replay-spike/research/no-alpha-mult-unit-context-v40.json'
if output.exists(): raise ValueError('Preserve prior context proof')
result = {'schema': 1, 'kind': 'explicit-original-numerical-harness-bound-size-context-readback', 'inputs': inputs, 'rows': rows, 'originalBlocks': list(n.blocks.values()), 'scope': {'authoredAssetsUnchanged': True, 'parentBoundSizeIsSuppliedNumericalHarnessInput': True, 'originalComponentCurrentFactorReadBack': True, 'matchBoundObjectSizeRecovered': False, 'productionAdmissionChanged': False}}
output.write_text(json.dumps(result, indent=2))
print(json.dumps({'output': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'rows': rows}))
