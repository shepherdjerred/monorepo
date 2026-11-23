"""A/B original math initialization, without changing the admitted sampler."""
import argparse
import importlib.util
import json
from pathlib import Path
import struct
import sys
import unicorn
from unicorn import x86_const as r


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['source_cache', 'actor', 'plan', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--source', required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    probe = Path(__file__).with_name('probe-archived-animation-native.py')
    spec = importlib.util.spec_from_file_location('scout_animation_probe_audit', probe)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    original = module.NativeArchivedAnimation
    reports, contexts = {}, {}
    for mode in ['legacy-range', 'full-range']:
        instances = []

        class AuditedAnimation(original):
            def __init__(self, *values):
                self.audit_reads, self.active_entry = {}, None
                super().__init__(*values)
                if mode == 'full-range':
                    self.call(0x14aa3bf, {}, 0x14aa5f9)
                self.u.hook_add(unicorn.UC_HOOK_MEM_READ, self.audit_read,
                                begin=self.base+0x2500000, end=self.base+0x2600000)
                instances.append(self)

            def call(self, entry, regs, end=None):
                previous, self.active_entry = self.active_entry, entry
                try:
                    result = super().call(entry, regs, end)
                    if entry == 0x14aa41b:
                        self.math_after_initialization = bytes(self.u.mem_read(self.base+0x256c000, 0x1000))
                    return result
                finally:
                    self.active_entry = previous

            def audit_read(self, uc, access, address, size, value, user):
                if self.active_entry in [0x14aa3bf, 0x14aa41b]:
                    return
                at = address-self.base
                identity = f'{at:x}/{size}'
                row = self.audit_reads.setdefault(identity, {'rva': at, 'bytes': size, 'hits': 0, 'readers': set(), 'values': set()})
                row['hits'] += 1
                row['readers'].add(self.u.reg_read(r.UC_X86_REG_RIP)-self.base)
                row['values'].add(bytes(self.u.mem_read(address, size)).hex())

        module.NativeArchivedAnimation = AuditedAnimation
        sys.argv = [str(probe), str(args.source_cache/'public/decoder-16.21-macos'), str(args.source_cache/'research/LeagueofLegends-macos'), str(args.actor), str(args.plan), str(args.output/(mode+'.json')), '--source', args.source, '--all-frames', '--clip-output', str(args.output/(mode+'.clip'))]
        module.main()
        instance = instances[0]
        reads = [{**row, 'readers': sorted(row['readers']), 'values': sorted(row['values'])} for row in instance.audit_reads.values()]
        contexts[mode] = {'mathHex': instance.math_after_initialization.hex(), 'globalReads': reads}
        reports[mode] = json.loads((args.output/(mode+'.json')).read_bytes())
    left, right = reports['legacy-range'], reports['full-range']
    if left['sourceSha256'] != right['sourceSha256'] or left['rigSha256'] != right['rigSha256'] or left['trackIndices'] != right['trackIndices'] or left['rigJointsOriginal'] != right['rigJointsOriginal']:
        raise ValueError('A/B original source or rig context differs')
    differences = []
    for index, (old, new) in enumerate(zip(left['samples'], right['samples'])):
        if old['time'] != new['time']:
            raise ValueError('A/B original sample grids differ')
        if old['localPosesHex'] != new['localPosesHex']:
            before, after = bytes.fromhex(old['localPosesHex']), bytes.fromhex(new['localPosesHex'])
            lanes = [{'component': at//4, 'beforeBits': before[at:at+4].hex(), 'afterBits': after[at:at+4].hex(), 'before': struct.unpack('<f', before[at:at+4])[0], 'after': struct.unpack('<f', after[at:at+4])[0]} for at in range(0, len(before), 4) if before[at:at+4] != after[at:at+4]]
            differences.append({'sample': index, 'time': old['time'], 'changedComponents': len(lanes), 'first': lanes[:20]})
    if len(left['samples']) != len(right['samples']):
        raise ValueError('A/B original sample coverage differs')
    old_math, new_math = [bytes.fromhex(contexts[mode]['mathHex']) for mode in ['legacy-range','full-range']]
    changed = [0x256c000+at for at in range(len(old_math)) if old_math[at] != new_math[at]]
    dependent = {mode: [row for row in context['globalReads'] if any(row['rva'] <= at < row['rva']+row['bytes'] for at in changed)] for mode,context in contexts.items()}
    result = {'schema': 1, 'kind': 'original-compressed-animation-initializer-ab', 'sourceSha256':left['sourceSha256'], 'rigSha256':left['rigSha256'], 'sourceFile':args.source, 'legacyRange':[0x14aa41b,0x14aa516], 'fullRange':[0x14aa3bf,0x14aa5f9], 'samples':len(left['samples']), 'changedGlobalBytes':changed, 'readsIntersectingChangedGlobals':dependent, 'poseDifferences':differences, 'clipsIdentical':left['nativeClip']['sha256']==right['nativeClip']['sha256'], 'contexts':contexts, 'nativeSpectatorAdmitted':False}
    (args.output/'audit.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'output':str(args.output),'samples':result['samples'],'changedGlobalBytes':len(changed),'dependentGlobalReads':{mode:len(rows) for mode,rows in dependent.items()},'differingSamples':len(differences),'clipsIdentical':result['clipsIdentical']}))


if __name__ == '__main__':
    main()
