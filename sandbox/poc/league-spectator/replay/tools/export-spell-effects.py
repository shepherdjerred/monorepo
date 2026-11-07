"""Static BIN missile bindings. No replay or guessed effect-name associations."""
import os, json, sys
from pathlib import Path
cache = Path(sys.argv[1])
os.environ['CDTB_HASHES_DIR'] = str((cache / 'vfx').resolve())
import cdtb.binfile as binfile
for hashes in [binfile.hashfile_binentries, binfile.hashfile_binhashes, binfile.hashfile_binhashes_xxh3]:
    hashes.hashes = {}
binfile.hashfile_binpaths.filename = cache / 'hashes.game.txt'

def elf(name):
    value = 0
    for byte in name.lower().encode():
        value = (value << 4) + byte
        high = value & 4026531840
        if high:
            value ^= high >> 24
        value &= ~high
    return value
package = {'schema': 2, 'build': '16.14.794.5912', 'missiles': {}, 'effects': {}, 'spells': {}, 'names': {}, 'unresolvedBindings': [], 'limitations': ['Base skins only; orientation and blend conventions require reference comparison', 'Linear trajectories; no target homing or confirmed impacts', 'Random distributions, flex, distortion, child effects and skeletal attachments incomplete', 'No effect inferred from a spell slot or filename']}
for folder in sorted((cache / 'vfx/champions').iterdir()):
    if not folder.is_dir():
        continue
    champion = folder.name
    objects = {}
    for path in folder.glob('*.bin'):
        objects.update(binfile.BinFile(str(path)).to_serializable())
    skin = json.loads((folder / 'skin.json').read_text())
    resources = {}
    for obj in skin.values():
        if isinstance(obj, dict):
            resources.update(obj.get('resourceMap', {}))
    resources = {alias: v for k, v in resources.items() for alias in [k.lower(), '{%08x}' % binfile.compute_binhash(k)]}
    for obj in objects.values():
        if not isinstance(obj, dict):
            continue
        name = obj.get('ObjectName') or obj.get('mScriptName')
        if not name:
            continue
        package['names'][str(elf(name))] = name
        spell = obj.get('mSpell', {})
        package['spells'][champion + ':' + str(elf(name))] = {'name': name, 'animation': spell.get('mAnimationName'), 'castTime': spell.get('mCastTime'), 'castFrame': spell.get('castFrame'), 'cantCancelWindup': spell.get('mCantCancelWhileWindingUp', False)}
        key = spell.get('mMissileEffectKey')
        if not key:
            continue
        path = resources.get(key.lower())
        definition = objects.get('{%08x}' % binfile.compute_binhash(path)) if path else None
        if not definition:
            package['unresolvedBindings'].append({'champion': champion, 'spell': name, 'effectKey': key, 'path': path})
            continue
        effect_id = champion + ':' + path
        package['missiles'][champion + ':' + str(elf(name))] = effect_id
        if effect_id in package['effects']:
            continue
        emitters = []
        omitted = []
        for i, emitter in enumerate(definition.get('complexEmitterDefinitionData', [])):
            primitive = emitter.get('primitive', {}).get('__type', 'VfxPrimitiveCameraQuad')
            reasons = []
            if primitive not in ['VfxPrimitiveArbitraryQuad', 'VfxPrimitiveCameraQuad', 'VfxPrimitiveCameraTrail', 'VfxPrimitiveArbitraryTrail', 'VfxPrimitiveMesh']:
                reasons.append('unsupported primitive ' + primitive)
            if not emitter.get('texture'):
                reasons.append('no texture')
            if emitter.get('particleLifetime', {}).get('constantValue', 0) <= 0:
                reasons.append('no positive lifetime')
            if emitter.get('rate', {}).get('constantValue', 0) <= 0 and (not emitter.get('isSingleParticle')):
                reasons.append('no constant emission rate')
            if emitter.get('isDisabled') or emitter.get('disabled'):
                reasons.append('disabled emitter')
            if reasons:
                omitted.append({'name': emitter.get('emitterName'), 'reasons': reasons})
            else:
                emitters.append({**emitter, 'id': effect_id + ':' + str(i)})
        package['effects'][effect_id] = {'champion': champion, 'definition': path, 'emitters': emitters, 'omittedEmitters': omitted}
(cache / 'public/effects').mkdir(parents=True, exist_ok=True)
(cache / 'public/effects/package.json').write_text(json.dumps(package))
print('Exported', len(package['missiles']), 'missile bindings,', len(package['effects']), 'effects')
