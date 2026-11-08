import difflib, hashlib, json
from pathlib import Path

root = Path.cwd()
manifest_path = root / '.cache/replay-spike/research/direct-effects-v38-archive.json'
raw = manifest_path.read_bytes()
assert hashlib.sha256(raw).hexdigest() == '629dcad2ce90ef83327b3810623f8d0a5ff8f09878445717303fec3b00db994c'
manifest = json.loads(raw)
prior = {str(Path(a['sourcePath'])).lower(): a for a in manifest['artifacts'] if a['kind'] == 'final-production-source'}
names = ['latest-viewer.mjs', 'latest-viewer-frame-coordination.mjs', 'latest-direct-reply-loop.mjs',
         'latest-direct-effect-presentation.mjs', 'latest-direct-effect-session.mjs',
         'latest-display-facing.mjs', 'latest-world-presentation.mjs', 'latest-viewer-pose-service.mjs',
         'latest-spectator-display-ticks.mjs', 'latest-spectator-diagnostics.mjs', 'latest-spectator-recording-analysis.mjs']
rows, diffs = [], []
for name in names:
    current_path = root / 'sandbox/poc/league-spectator/replay' / name
    now = current_path.read_bytes()
    # The archive records the source location used by that historical run.
    # Relocating current source must not turn an existing V38 file into "new".
    historical_path = root / 'packages/scout-for-lol/spikes/replay' / name
    entry = prior.get(str(historical_path).lower())
    before = b'' if entry is None else Path(entry['archivePath']).read_bytes()
    if entry:
        assert hashlib.sha256(before).hexdigest() == entry['sha256']
    delta = list(difflib.unified_diff(before.decode().splitlines(True), now.decode().splitlines(True), fromfile='V38/' + name, tofile='current/' + name))
    rows.append({'name': name, 'currentSha256': hashlib.sha256(now).hexdigest(), 'v38Sha256': entry['sha256'] if entry else None, 'diffLines': len(delta)})
    diffs.extend(delta)
out = root / '.cache/replay-spike/research/v39-r2-reviewed-core-diff.txt'
out.write_text(''.join(diffs), encoding='utf-8')
report = root / '.cache/replay-spike/research/v39-r2-reviewed-core-inputs.json'
report.write_text(json.dumps({'archiveSha256': hashlib.sha256(raw).hexdigest(), 'files': rows}, indent=2))
print(json.dumps({'output': str(out), 'inputs': str(report), 'files': rows}, indent=2))
