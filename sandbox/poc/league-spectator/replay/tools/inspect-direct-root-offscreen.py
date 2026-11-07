"""Validate the exact original empty-view wrapper controls and classify scope."""
import argparse
import json
from pathlib import Path

from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    path = cache / 'research/direct-root-offscreen-native.json'
    native = json.loads(path.read_bytes())
    for filename, digest in native['inputs'].items():
        if sha(Path(filename).read_bytes()) != digest:
            raise ValueError('Native offscreen input changed: ' + filename)
    for filename, digest in native['sources'].items():
        if sha(Path(__file__).with_name(filename).read_bytes()) != digest:
            raise ValueError('Native offscreen producer changed: ' + filename)
    baseline = cache / 'research/direct-root-identity-activation-native.json'
    if sha(baseline.read_bytes()) != native['baselineSha256']:
        raise ValueError('Independent original parent baseline changed')
    if sorted(c['flags'] for c in native['cases']) != [197, 198, 212, 213]:
        raise ValueError('Required observed/default/offscreen flag controls missing')
    summaries = []
    for case in native['cases']:
        control, frames = case['controls'], case['frames']
        if (control['managerByte34d'] != 0 or control['globalByte'] != 0 or
                control['parentF8'] != 0 or control['viewVectorHex'] != bytes(16).hex() or
                control['argEdx'] != 0 or control['argEcx'] != 20):
            raise ValueError('Offscreen control is not the exact bounded supplied case')
        calls = sum(f['branches'].get(str(0x1744ebb), 0) for f in frames)
        same_geometry = all(f['referenceGeometryMatch'] for f in frames)
        same_rng = all(f['referenceRngMatch'] for f in frames)
        if case['flags'] & 1:
            if calls != 110 or not same_geometry or not same_rng:
                raise ValueError('Original SimulateWhileOffScreen control differs from parent oracle')
        elif calls or any(any(f['particles']) or f['substeps'] for f in frames):
            raise ValueError('Original empty-view no-offscreen control unexpectedly simulated')
        summaries.append({'flags': case['flags'], 'frames': len(frames),
                          'parentTickCalls': calls, 'geometryMatchesDirectParentEveryFrame': same_geometry,
                          'rngMatchesDirectParentEveryFrame': same_rng,
                          'emptyPoolsEveryFrame': not any(any(f['particles']) for f in frames),
                          'emptyViewBranchEveryFrame': all(f['branches'].get(str(0x1744ced)) == 1 for f in frames),
                          'controls': control})
    result = {'schema': 1, 'kind': 'original-parent-offscreen-wrapper-classification',
              'build': native['build'], 'protocol': native['protocol'], 'cases': summaries,
              'nativeReportSha256': sha(path.read_bytes()), 'nativeReport': str(path),
              'wrapperCodeSha256': sha(bytes.fromhex(native['wrapperBytesHex'])),
              'scope': {'fullOriginalWrapperExecuted': True, 'emptyViewControlledInput': True,
                        'actualMatchCullingOrVisibilityRecovered': False,
                        'diagnosticGeometryIsIndependentOfWrapperVisibility': True,
                        'defaultFlag212AlsoUsesOffscreenGate': True,
                        'normalSpectatorVisibilityParity': False, 'compilerAdmissionChanged': False},
              'sources': {Path(__file__).name: sha(Path(__file__).read_bytes())}}
    output = cache / 'research/direct-root-offscreen-classification.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': summaries}))


if __name__ == '__main__':
    main()
