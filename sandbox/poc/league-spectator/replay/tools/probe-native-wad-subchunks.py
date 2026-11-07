"""Check original installed archive subchunk-table loading independently."""
import argparse
import inspect
import json
from pathlib import Path
from character_script_native import NativeCharacterScripts
from native_ai_unit_fixture import NativeAIUnitFixture
from archive_subchunks_native import load_installed_subchunks
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'installation']:
        p.add_argument(name, type=Path)
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, NativeCharacterScripts)
    n = fixture.native
    if sha(fixture.raw(args.installation / 'Game/League of Legends.exe')) != n.profile['windowsClientSha256']:
        raise ValueError('Exact matching installed executable required')
    manager = n.file_manager()
    result = []
    for relative in ['Global.wad.client', 'Champions/Karthus.wad.client']:
        path = (args.installation / 'Game/DATA/FINAL' / relative).resolve()
        encoded = fixture.raw(path)
        n.allow_file(path)
        archive = n.register_archive(manager, path)
        result.append(load_installed_subchunks(fixture, args.installation, path, archive, encoded))
    paths = {Path(__file__), Path(inspect.getfile(load_installed_subchunks)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    output = fixture.cache / 'research/native-wad-subchunks.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
                                 'decoderImageSha256': n.profile['decoderImageSha256'],
                                 'inputs': fixture.inputs, 'subchunks': result,
                                 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
                                 'originalBlocks': list(n.blocks.values()),
                                 'scope': {'originalLoaderExecuted': True, 'suppliedInstallationRoot': True,
                                           'completeArchivePayloadCoverage': False, 'matchCoverage': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'subchunks': result}))


if __name__ == '__main__':
    main()
