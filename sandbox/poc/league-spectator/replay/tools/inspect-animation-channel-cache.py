"""Compare original serialized jump keys with captured native cache values."""
import argparse
import json
from pathlib import Path
import struct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('native', type=Path)
args = parser.parse_args()
raw = args.source.read_bytes()
native = json.loads(args.native.read_bytes())
if native['boundary'] is not None or raw[:8] != b'r3d2canm':
    raise ValueError('Completed original compressed probe required')
joint_count, frame_count = struct.unpack_from('<II', raw, 24)
keys_offset = struct.unpack_from('<I', raw, 120)[0]+12
if frame_count >= 0x10001 or native['cacheAtZero']['bytesPerTrack'] != 184:
    raise ValueError('Explicit 16-bit compressed jump-key control required')
rows = []
for track in range(joint_count):
    keys = struct.unpack_from('<12H', raw, keys_offset+track*24)
    for channel, first, width, pose_offset in [('quaternion', 0, 4, 24), ('position', 4, 3, 0), ('scale', 8, 3, 12)]:
        selected = keys[first:first+4]
        if not any(index == 65535 for index in selected):
            continue
        controls = []
        for joint, bound in enumerate(native['trackIndices']):
            if bound != track:
                continue
            bind = bytes.fromhex(native['bindLocalPosesHex'][joint])[pose_offset:pose_offset+width*4]
            values = [bytes.fromhex(sample['localPosesHex'])[joint*40+pose_offset:joint*40+pose_offset+width*4] for sample in native['samples']]
            controls.append({'joint': joint, 'bindValues': struct.unpack('<'+'f'*width, bind), 'originalSampleValues': [struct.unpack('<'+'f'*width, value) for value in dict.fromkeys(values)], 'allOriginalSamplesPreserveBindBits': all(value == bind for value in values)})
        rows.append({'track': track, 'channel': channel, 'originalKeys': selected, 'rigControls': controls})
hash_offset = struct.unpack_from('<I', raw, 124)[0]+12
binding = []
for joint, track in enumerate(native['trackIndices']):
    key = native['rigJointsOriginal'][joint]['resolvedBoneKey']
    asset_key = struct.unpack_from('<I', raw, hash_offset+track*4)[0] if track >= 0 else None
    if key != asset_key:
        binding.append({'joint': joint, 'rigKey': key, 'animationKey': asset_key, 'track': track})
print(json.dumps({'bindingKeyDisagreements': binding, 'missingChannelControls': len(rows), 'allPreserveOriginalBindBits': all(control['allOriginalSamplesPreserveBindBits'] for row in rows for control in row['rigControls']), 'firstControls': rows[:8]}, indent=2))
