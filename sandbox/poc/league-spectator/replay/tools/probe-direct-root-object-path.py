"""Trace exact-build root objectPath identity without granting runtime admission.

The original typed property reader/postload runs on isolated HASH controls;
complete prepared roots are checked separately against their authored identities.
Static use sites retain code bytes for ancestry/deferred-child follow-up.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct

from vfx_system_asset_native import NativeVfxSystemAssets
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    assets = cache / 'public'
    inputs = {}

    def read(path):
        raw = path.read_bytes()
        inputs[str(path)] = sha(raw)
        return json.loads(raw)

    manifest = read(assets / 'latest-effects/manifest.json')
    systems = read(assets / 'latest-vfx-system-assets/package.json')
    if systems['effectsManifestSha256'] != inputs[str(assets / 'latest-effects/manifest.json')]:
        raise ValueError('Root identity manifest differs from native assets')
    if set(systems['systems']) != set(manifest['definitions']):
        raise ValueError('Root identity corpus is incomplete')
    roots = []
    for effect_id, ref in systems['systems'].items():
        graph_path = assets / 'latest-vfx-system-assets' / ref['file']
        graph = read(graph_path)
        source_ref = manifest['definitions'][effect_id]
        source_path = assets / 'latest-effects' / source_ref['file']
        source = read(source_path)
        identity = int(effect_id.rsplit('/', 1)[-1], 16)
        if inputs[str(graph_path)] != ref['sha256'] or inputs[str(source_path)] != source_ref['sha256']:
            raise ValueError('Root identity graph/source hash changed')
        if ref['definitionSha256'] != source_ref['sha256'] or graph['effectId'] != effect_id:
            raise ValueError('Root identity graph definition differs')
        if source['definition']['objectPath'] != '{' + f'{identity:08x}' + '}':
            raise ValueError('Authored objectPath differs from definition identity')
        root = bytes.fromhex(graph['objectHex'])
        if len(root) != 0x160 or struct.unpack_from('<I', root, 0x148)[0] != identity:
            raise ValueError('Original root objectPath differs from authored identity')
        typed_fields = [f for f in ref['fields'] if f['hash'] == 0x1d369c29]
        if len(typed_fields) != 1 or typed_fields[0]['type'] != 17 or typed_fields[0]['bytes'] != 9:
            raise ValueError('Root objectPath is not the original typed HASH field')
        roots.append({'effectId': effect_id, 'identity': identity,
                      'nativeFieldOffset': 0x148, 'sourceField': typed_fields[0]})
    n = NativeVfxSystemAssets(assets / 'decoder-16.21-macos', args.client)
    controls = []
    for supplied in [None, 0, 1, 0x5de482fb, 0x80000000, 0xffffffff]:
        identity = 0 if supplied is None else supplied
        fields = [] if supplied is None else [struct.pack('<IBI', 0x1d369c29, 17, identity)]
        before = n.load_system(fields)
        after = n.postload_system()
        before_bytes, after_bytes = bytes.fromhex(before['objectHex']), bytes.fromhex(after['objectHex'])
        observed = struct.unpack_from('<I', after_bytes, 0x148)[0]
        if observed != identity or before_bytes != after_bytes or before['ignored'] or before['mismatched']:
            raise ValueError('Original HASH reader/postload did not preserve root identity')
        controls.append({'identity': identity, 'authored': supplied is not None, 'nativeObserved': observed,
                         'postloadPreservedRootBytes': True, 'streamCalls': before['streamCalls']})
        n.restore_preload_arena()
    sites = [
        (0x16e797a, 0x16e7995, 'typed root registration: hash 1d369c29 at offset148'),
        (0x1779c90, 0x1779ca4, 'root constructor initializes objectPath to zero'),
        (0x16e92ea, 0x16e930c, 'complex child resource request passes root identity in EDX'),
        (0x16e982a, 0x16e9850, 'simple child resource request passes root identity in EDX'),
        (0x1755c3a, 0x1755c5f, 'child activation passes root identity to deferred request'),
        (0x174b1a7, 0x174b1df, 'child resource factory retains parent identity'),
        (0x174b2a8, 0x174b2bb, 'child resource factory passes parent identity to resource reader'),
        (0x174b57e, 0x174b5b2, 'deferred request retains parent identity at request offset40'),
    ]
    original_sites = []
    for start, end, meaning in sites:
        raw = n.source.image[start:end]
        if n.image[start:end] != raw:
            raise ValueError('Root identity source code differs from original image')
        original_sites.append({'startRva': start, 'endRva': end, 'bytesHex': raw.hex(),
                               'sha256': sha(raw), 'interpretation': meaning})
    source_paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'direct-root-object-path-native-identity',
              'build': manifest['build'], 'protocol': manifest['protocol'],
              'decoderImageSha256': n.profile['decoderImageSha256'], 'roots': roots, 'controls': controls,
              'originalSites': original_sites, 'originalBlocks': list(n.blocks.values()),
              'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(source_paths)},
              'scope': {'originalTypedHashReaderAndPostload': True, 'completePreparedRootIdentityChecked': True,
                        'objectPathIsConsumedByChildRequests': True, 'nativeParentActivation': False,
                        'allClientUsesEnumerated': False, 'rootAdmissionChanged': False,
                        'wholeEffectBehaviorIndependentOfIdentityProven': False, 'matchCoverage': False}}
    output = cache / 'research/direct-root-object-path-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'roots': len(roots), 'typedControls': len(controls),
                      'codeSites': len(original_sites), 'runtimeAdmissionChanged': False}))


if __name__ == '__main__':
    main()
