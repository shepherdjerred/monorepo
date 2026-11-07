"""Exercise original product construction from explicit process-argument inputs."""
import argparse
import inspect
import json
from pathlib import Path
from native_ai_unit_fixture import NativeAIUnitFixture
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cases = []
    for product in ['LoL', 'TFT']:
        fixture = NativeAIUnitFixture(args.cache, args.client)
        n = fixture.native
        result = initialize_product_configuration(n, product)
        paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
                 Path(inspect.getfile(initialize_product_configuration)),
                 *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
        cases.append({'control': result, 'inputs': fixture.inputs,
                      'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
                      'originalBlocks': list(n.blocks.values())})
    output = fixture.cache / 'research/product-configuration-native.json'
    output.write_text(json.dumps({'schema': 1, 'kind': 'original-product-argument-construction',
                                 'build': n.profile['clientVersion'], 'cases': cases}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'products': [c['control']['product'] for c in cases]}))


if __name__ == '__main__':
    main()
