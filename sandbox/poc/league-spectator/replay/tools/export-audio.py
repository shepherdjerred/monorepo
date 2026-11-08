"""Render static, explicitly named cast/attack/death SFX events into browser PCM.

WWISER preserves event layers; one generated random variant is selected per event.
Wwise buses/RTPCs/switch state are not reproduced. No replay is read here.
"""
import hashlib, json, re, subprocess, sys
from pathlib import Path
research = Path(sys.argv[1])
cache = Path(sys.argv[2])
out = cache / 'public/audio'
out.mkdir(parents=True, exist_ok=True)
package = json.loads((cache / 'public/effects/package.json').read_text())
result = {'build': package['build'], 'bindings': {}, 'clips': {}, 'omittedEvents': [], 'limitations': ['Named cast/attack/death events only; trigger bindings follow asset naming conventions', 'One fixed event variant; Wwise switches, RTPCs, buses and spatial mixing not reconstructed', 'Looping events excluded; replay speed changes pitch']}

def elf(name):
    v = 0
    for b in name.lower().encode():
        v = (v << 4) + b
        h = v & 4026531840
        if h:
            v ^= h >> 24
        v &= ~h
    return v
for folder in sorted((cache / 'audio').iterdir()):
    if not folder.is_dir():
        continue
    proc = subprocess.run([sys.executable, str(research / 'wwiser/wwiser.py'), '-d', 'none', '-g', '-gd', '*.bnk'], cwd=folder, capture_output=True, text=True)
    if proc.returncode:
        raise RuntimeError(proc.stdout + proc.stderr)
    if 'ERROR' in proc.stdout:
        raise RuntimeError(proc.stdout)
    events = json.loads((folder / 'events.json').read_text())
    for name in events:
        prefix = 'Play_sfx_' + folder.name + '_'
        if not name.lower().startswith(prefix.lower()):
            continue
        body = name[len(prefix):]
        binding = None
        if body.lower().startswith('death3d_'):
            binding = folder.name + ':death'
        else:
            suffix = next((s for s in ['_OnCast', '_cast'] if body.lower().endswith(s.lower())), None)
            if not suffix:
                continue
            spell = body[:-len(suffix)]
            key = folder.name + ':' + str(elf(spell))
            if key not in package['spells']:
                continue
            binding = key
        candidates = sorted((p for p in (folder / 'txtp').glob('*.txtp') if p.stem == name or p.stem.startswith(name + ' ')))
        if not candidates:
            result['omittedEvents'].append({'event': name, 'reason': 'No generated playable event'})
            continue
        source = candidates[0]
        graph = source.read_text()
        if re.search('sLoopCount: 0(?:\\s|$)', graph):
            result['omittedEvents'].append({'event': name, 'reason': 'Looping event'})
            continue
        key = hashlib.sha256(name.encode()).hexdigest()[:20]
        target = out / (key + '.wav')
        if not target.exists():
            proc = subprocess.run([str(research / 'vgmstream/vgmstream-cli.exe'), '-i', '-o', str(target.resolve()), str(source.resolve())], capture_output=True, text=True)
            if proc.returncode:
                raise RuntimeError(proc.stdout + proc.stderr)
        result['clips'][key] = {'file': key + '.wav', 'event': name, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
        result['bindings'][binding] = key
        if body.lower() == folder.name.lower() + 'basicattack_oncast':
            result['bindings'][folder.name + ':attack'] = key
    print(folder.name, 'prepared')
(out / 'package.json').write_text(json.dumps(result))
print(len(result['bindings']), 'bindings', len(result['clips']), 'clips')
