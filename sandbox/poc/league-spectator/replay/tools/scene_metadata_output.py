"""Owned derived definitions, with the approved native package kept read-only."""
import hashlib
import json
from pathlib import Path
import sys


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


class SceneMetadataOutput:
    def __init__(self, package, scene, output, evidence, extra_roots=()):
        self.package = Path(package).resolve(strict=True)
        self.scene = Path(scene).resolve(strict=True)
        self.output = Path(output).resolve()
        self.evidence = Path(evidence).resolve()
        for root in [self.package, self.scene, *[Path(root).resolve(strict=True) for root in extra_roots]]:
            if self.output.is_relative_to(root) or root.is_relative_to(self.output):
                raise ValueError('Derived metadata output must be disjoint from native and scene inputs')
        if not self.evidence.is_relative_to(self.output) or self.evidence == self.output:
            raise ValueError('Metadata evidence must stay inside its owned output directory')
        self.inputs = {}
        self.package_files = sorted(file.relative_to(self.package).as_posix()
                                    for file in self.package.rglob('*') if file.is_file())
        for file in self.package_files:
            self.read(self.package/file)
        self.profile_raw = self.read(self.package/'profile.json')
        self.profile = json.loads(self.profile_raw)
        self.image_sha256 = digest(self.read(self.package/'image.bin'))
        if self.image_sha256 != self.profile['decoderImageSha256']:
            raise ValueError('Approved profile/image authority differs')
        self.scene_manifest_raw = self.read(self.scene/'manifest.json')
        manifest = json.loads(self.scene_manifest_raw)
        self.scene_inventory = None
        if manifest.get('kind') == 'archived-map11-common-runtime-scene':
            if not isinstance(manifest.get('files'), list) or not manifest['files']:
                raise ValueError('New scene requires its closed static file inventory')
            self.scene_inventory = {entry['path']: entry for entry in manifest['files']}
            if len(self.scene_inventory) != len(manifest['files']):
                raise ValueError('Duplicate static scene file identities')
        self.sources = {}
        root = Path(__file__).resolve().parent
        for module in tuple(sys.modules.values()):
            file = getattr(module, '__file__', None)
            if file and Path(file).resolve().parent == root:
                resolved = Path(file).resolve()
                self.sources[str(resolved)] = digest(resolved.read_bytes())
        self.output.mkdir(parents=True, exist_ok=True)

    def read(self, file):
        file = Path(file).resolve(strict=True)
        raw = file.read_bytes()
        previous = self.inputs.setdefault(str(file), digest(raw))
        if previous != digest(raw):
            raise ValueError(f'Metadata source changed between reads: {file}')
        return raw

    def read_scene(self, relative):
        file = (self.scene/relative).resolve(strict=True)
        if not file.is_relative_to(self.scene):
            raise ValueError('Metadata scene input escaped its selected static authority')
        raw = self.read(file)
        key = file.relative_to(self.scene).as_posix()
        if self.scene_inventory is not None:
            expected = self.scene_inventory.get(key)
            if not expected or expected.get('bytes') != len(raw) or expected.get('sha256') != digest(raw):
                raise ValueError(f'Scene metadata input differs from closed inventory: {key}')
        return raw

    def verify(self):
        current = sorted(file.relative_to(self.package).as_posix()
                         for file in self.package.rglob('*') if file.is_file())
        if current != self.package_files:
            raise ValueError('Approved native package file inventory changed')
        for file, expected in {**self.inputs, **self.sources}.items():
            if digest(Path(file).read_bytes()) != expected:
                raise ValueError(f'Metadata input or producer changed: {file}')

    def publish(self, filename, raw, kind):
        if filename not in ['animation-clock.json', 'animation-rigs.json', 'animation-events.json']:
            raise ValueError('Known derived metadata definition required')
        target = (self.output/filename).resolve()
        receipt = (self.output/(filename+'.authority.json')).resolve()
        if not target.is_relative_to(self.output) or not receipt.is_relative_to(self.output):
            raise ValueError('Derived metadata path escaped its owned output')
        if target.exists() or receipt.exists():
            raise ValueError('Derived definition output already exists; use a fresh owned namespace')
        self.verify()
        authority = {'schema': 1, 'kind': 'original-scene-metadata-definition-authority',
                     'definition': {'kind': kind, 'file': filename, 'sha256': digest(raw)},
                     'build': self.profile['clientVersion'], 'protocol': self.profile['protocolDigest'],
                     'baseProfileSha256': digest(self.profile_raw), 'imageSha256': self.image_sha256,
                     'sceneManifestSha256': digest(self.scene_manifest_raw),
                     'decoderImageSha256': self.profile['decoderImageSha256'],
                     'inputs': self.inputs, 'producerSources': self.sources,
                     'scope': {'approvedProfileModified': False, 'imageModified': False,
                               'dynamicStateProgramAdmitted': False, 'nativeSpectatorAdmitted': False}}
        target.write_bytes(raw)
        receipt.write_text(json.dumps(authority, indent=2), encoding='utf-8')
        return authority

    def write_evidence(self, raw):
        self.verify()
        if self.evidence.exists():
            raise ValueError('Metadata evidence output already exists')
        self.evidence.parent.mkdir(parents=True, exist_ok=True)
        self.evidence.write_bytes(raw)
