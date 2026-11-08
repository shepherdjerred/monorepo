"""Validate separately prepared installed static skin/SKN admission inputs."""
from pathlib import Path
import re
import struct
from vfx_spawn_native import sha


def installed_skn_shape(data):
    if len(data) < 12 or struct.unpack_from('<IHH', data) != (0x112233, 4, 1):
        raise ValueError('Exact installed SKN4.1 shape required')
    groups = struct.unpack_from('<I', data, 8)[0]
    at = 12 + groups * 80
    if not 0 < groups <= 4096 or at + 60 > len(data):
        raise ValueError('Installed SKN group/header bounds differ')
    flags, indices, vertices, stride, format_ = struct.unpack_from('<5I', data, at)
    if (flags or not 0 < indices <= 0x100000 or not 0 < vertices <= 65535 or
            (stride, format_) not in [(52, 0), (72, 2)]):
        raise ValueError('Installed SKN layout is not an established static shape')
    if at + 60 + indices * 2 + vertices * stride + 12 != len(data) or data[-12:] != bytes(12):
        raise ValueError('Installed SKN vertex/index spans differ')
    return {'vertices': vertices, 'stride': stride, 'format': format_, 'indices': indices,
            'vertexBytes': vertices * stride, 'sourceBytes': len(data), 'sourceSha256': sha(data)}


def configure_installed_skin_vertices(fixture, installation, hero):
    n = fixture.native
    if (not isinstance(hero, dict) or hero.get('kind') != 'hero-creation-candidate' or
            not isinstance(hero.get('champion'), str) or
            not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', hero['champion']) or
            type(hero.get('skinId')) is not int or not 0 <= hero['skinId'] <= 1000):
        raise ValueError('Decoded hero-creation candidate with canonical integer skinId required')
    path = fixture.cache / 'research' / f"recorded-hero-skn-{hero['champion'].lower()}-{hero['skinId']}" / 'manifest.json'
    manifest = fixture.read(path)
    if (manifest['schema'] != 1 or manifest['kind'] != 'installed-static-skin-vertex-input' or
            manifest['build'] != n.profile['clientVersion'] or manifest['protocol'] != n.profile['protocolDigest'] or
            manifest['decoderImageSha256'] != sha(n.image) or manifest['windowsClientSha256'] != n.profile['windowsClientSha256'] or
            Path(manifest['installation']).resolve() != Path(installation).resolve() or
            manifest['champion'] != hero['champion'] or manifest['skin'] != hero['skinId'] or
            not manifest['scope']['installedStaticAssetOnly'] or manifest['scope']['acceptedReplayAppearance'] or
            manifest['scope']['resourceSelectionRecovered']):
        raise ValueError('Exact installed static skin admission package required')
    for source, digest in manifest['inputs'].items():
        if sha(fixture.raw(Path(source))) != digest:
            raise ValueError('Installed static skin input changed: ' + source)
    data = fixture.raw(Path(manifest['rawFile']))
    if sha(data) != manifest['sourceSha256']:
        raise ValueError('Installed static SKN bytes changed')
    shape = installed_skn_shape(data)
    large = []
    if shape['vertexBytes'] >= 0x100000:
        # The large-buffer port remains restricted to its independently proven
        # format. Ordinary small requests continue through the existing bridge.
        large = n.configure_skinned_vertex_inputs([data])
    return {'manifest': str(path.resolve()), 'authoredMeshPath': manifest['meshPath'],
            'decodedAppearanceInput': {'champion': hero['champion'], 'skinId': hero['skinId'],
                                       'skinIdStatus': hero.get('skinIdStatus')},
            'staticShape': shape, 'admittedLargeInputs': large,
            'acceptedAppearanceEstablished': False, 'resourceSelectionRecovered': False}
