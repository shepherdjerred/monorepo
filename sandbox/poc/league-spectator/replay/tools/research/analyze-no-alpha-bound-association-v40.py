"""Exact native pool lanes localize the moving-bound addition-order gap."""
import hashlib
import json
import struct
from pathlib import Path
ROOT = Path(__file__).resolve().parents[6]
inputs = {}
def read(path):
    path = ROOT / path; data = path.read_bytes()
    inputs[str(path)] = hashlib.sha256(data).hexdigest()
    return json.loads(data)
def f(value): return struct.unpack('<f', struct.pack('<f', value))[0]
def bits(value): return struct.unpack('<I', struct.pack('<f', value))[0]
native = read('.cache/replay-spike/research/no-alpha-mult-stream-raster-v40.json')
comparison = read('.cache/replay-spike/research/no-alpha-mult-stream-comparison-v40-r2.json')
source = next(row for row in native['rows'] if '/sona/' in row['materialKey'])
failed = next(row for row in comparison['rows'] if '/sona/' in row['materialKey'])
counts = {'frames': 0, 'particles': 0, 'deltaLanes': 0, 'centerLanes': 0, 'mismatchedVertexLanes': 0, 'nonpositionBytesDiffer': 0}
bad, witnesses = [], []
for frame in source['frames']:
    current = list(map(f, frame['input']['current']))
    state = frame['output']['state']['vectors']['particle']
    data = bytes.fromhex(state['hex'])
    counts['frames'] += 1
    for particle in range(state['count']):
        # Original native pool layout: two matrices, root translation+30,
        # current translation+80, and retained bind delta+a0 (strideac).
        birth = struct.unpack_from('<3f', data, particle * 0xac + 0x30)
        observed = struct.unpack_from('<3f', data, particle * 0xac + 0x80)
        delta = struct.unpack_from('<3f', data, particle * 0xac + 0xa0)
        counts['particles'] += 1
        for lane in range(3):
            expected_delta = f(current[lane] - birth[lane])
            expected_center = f(birth[lane] + expected_delta)
            counts['deltaLanes'] += 1; counts['centerLanes'] += 1
            if bits(expected_delta) != bits(delta[lane]) or bits(expected_center) != bits(observed[lane]):
                bad.append({'time': frame['input']['time'], 'particle': particle, 'lane': lane, 'birth': birth[lane], 'current': current[lane], 'expectedDelta': expected_delta, 'nativeDelta': delta[lane], 'expectedCenter': expected_center, 'nativeCenter': observed[lane]})
for mismatch in failed['mismatches']:
    actual, wanted = bytes.fromhex(mismatch['actualVertices']), bytes.fromhex(mismatch['expectedVertices'])
    frame = next(frame for frame in source['frames'] if frame['input']['time'] == mismatch['time'])
    data = bytes.fromhex(frame['output']['state']['vectors']['particle']['hex'])
    for at in range(0, len(actual), 28):
        if actual[at+12:at+28] != wanted[at+12:at+28]: counts['nonpositionBytesDiffer'] += 1
        for lane in range(3):
            a, e = struct.unpack_from('<f', actual, at+lane*4)[0], struct.unpack_from('<f', wanted, at+lane*4)[0]
            if bits(a) == bits(e): continue
            counts['mismatchedVertexLanes'] += 1
            particle = at // 112
            birth = struct.unpack_from('<3f', data, particle*0xac+0x30)[lane]
            current = f(frame['input']['current'][lane])
            first_subtract = f(birth-current)
            # This zero-offset bound source exposes the exact reassociation:
            # runtime folds birth-anchor to zero, native retains subtract/add.
            witnesses.append({'time': mismatch['time'], 'vertex': at//28, 'particle': particle, 'lane': lane, 'birthWorld': birth, 'currentAnchor': current, 'runtimeCenter': a, 'nativeCenter': e, 'ulpDistance': abs(bits(a)-bits(e)), 'nativeSubThenAdd': f(birth+f(current-birth)), 'foldedRelativeOriginThenCurrent': f(f(birth-birth)+current)})
result = {'schema': 1, 'kind': 'moving-bound-native-pool-addition-order-localization', 'inputs': inputs, 'counts': counts, 'nativePoolFormulaMismatches': bad, 'witnesses': witnesses, 'scope': {'nativePoolBytesObserved': True, 'exactF32ArithmeticCompared': True, 'formulaMatchesNotInstructionTrace': True, 'nativeCurrentCenterKeepsSubtractThenAdd': len(bad)==0, 'productionChanged': False, 'materialStillOmitted': True}}
output = ROOT / '.cache/replay-spike/research/no-alpha-mult-bound-association-v40.json'
if output.exists(): raise ValueError('Preserve prior localization')
output.write_text(json.dumps(result, indent=2))
print(json.dumps({'output': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'counts': counts, 'formulaMismatches': len(bad), 'witness': witnesses[0] if witnesses else None, 'maxUlp': max((row['ulpDistance'] for row in witnesses),default=0)}))
