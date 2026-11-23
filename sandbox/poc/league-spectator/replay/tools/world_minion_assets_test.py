import copy
import unittest
from world_minion_assets import world_minion_assets


def control():
    scene = {'build': '16.21.829.8620', 'protocol': '20e09df23c66b85e',
             'map': {'id': 11, 'recordedMapSkin': 'Default'}}
    binding = {'asset': 'neutral/sru_red/3', 'character': 'SRU_Red',
               'requestedSkinId': 3, 'resourceSkinId': 3,
               'characterRecords': ['Characters/SRU_Red/CharacterRecords/Root'],
               'characterSourceSha256': '1'*64}
    asset = {'character': 'SRU_Red', 'skinId': 3, 'characterRecords': binding['characterRecords'],
             'source': {'bins': [{'sha256': '1'*64}]}}
    world = {'mapId': 11, 'registration': [{'units': {0: {'asset': 'lane/0'}}}],
             'assets': {'lane/0': {}, binding['asset']: asset},
             'neutralCreation': {
                 'kind': 'original-default-map11-neutral-candidates',
                 'build': scene['build'], 'protocol': scene['protocol'],
                 'nativeClass': 'AIMinionClient', 'nativeVtableRva': 0x23013b8,
                 'mapSkin': 'Default', 'resourceSkinPolicy': 'original-empty-meta-default-map',
                 'scope': {'nativeFactoryAccepted': False, 'snapshotsCreateEntities': False},
                 'bindings': {'sru_red/3': binding}}}
    return scene, world


class WorldMinionAssetsTests(unittest.TestCase):
    def test_existing_lane_assets_do_not_require_a_neutral_policy(self):
        scene, world = control()
        del world['neutralCreation']
        scene['map']['id'] = world['mapId'] = 12
        self.assertEqual(world_minion_assets(scene, world), ({'lane/0'}, {}))

    def test_original_neutral_resource_and_lane_inventory_remain_distinct(self):
        scene, world = control()
        before = copy.deepcopy(world)
        assets, bindings = world_minion_assets(scene, world)
        self.assertEqual(assets, {'lane/0', 'neutral/sru_red/3'})
        self.assertEqual(set(bindings), {'neutral/sru_red/3'})
        self.assertEqual(world, before)

    def test_existing_skin_zero_does_not_replace_native_resource_three(self):
        scene, world = control()
        world['assets']['neutral/sru_red/3']['skinId'] = 0
        with self.assertRaisesRegex(ValueError, 'namespace does not match'):
            world_minion_assets(scene, world)

    def test_different_maps_variants_and_source_records_are_rejected(self):
        for change in ['map', 'variant', 'record']:
            scene, world = control()
            if change == 'map':
                scene['map']['id'] = 12
            elif change == 'variant':
                scene['map']['recordedMapSkin'] = 'Unknown'
            else:
                world['assets']['neutral/sru_red/3']['source']['bins'][0]['sha256'] = '2'*64
            with self.assertRaises(ValueError):
                world_minion_assets(scene, world)


if __name__ == '__main__':
    unittest.main()
