"""Explicit static asset enumeration for the native AIMinionClient consumers."""


def world_minion_assets(scene, world):
    assets = {unit['asset'] for entry in world['registration'] for unit in entry.get('units', {}).values()}
    policy = world.get('neutralCreation')
    bindings = {}
    if policy is None:
        return assets, bindings
    if (scene['map']['id'] != 11 or scene['map'].get('recordedMapSkin') != 'Default' or
            world['mapId'] != 11 or policy.get('kind') != 'original-default-map11-neutral-candidates' or
            policy.get('build') != scene['build'] or policy.get('protocol') != scene['protocol'] or
            policy.get('nativeClass') != 'AIMinionClient' or policy.get('nativeVtableRva') != 0x23013b8 or
            policy.get('mapSkin') != 'Default' or policy.get('resourceSkinPolicy') != 'original-empty-meta-default-map' or
            policy.get('scope', {}).get('nativeFactoryAccepted') is not False or
            policy.get('scope', {}).get('snapshotsCreateEntities') is not False):
        raise ValueError('Exact scoped Default Map11 neutral minion policy required')
    for key, binding in policy['bindings'].items():
        asset_key = binding['asset']
        asset = world['assets'].get(asset_key)
        if (asset_key != 'neutral/'+key or asset_key in bindings or asset is None or
                key != binding['character'].lower()+'/'+str(binding['requestedSkinId']) or
                binding['resourceSkinId'] != binding['requestedSkinId'] or
                asset['skinId'] != binding['resourceSkinId'] or
                asset['character'].lower() != binding['character'].lower() or
                binding['characterRecords'] != asset['characterRecords'] or
                not any(source['sha256'] == binding['characterSourceSha256'] for source in asset['source']['bins'])):
            raise ValueError('Original neutral asset/CharacterRecord namespace does not match native observations')
        bindings[asset_key] = binding
        assets.add(asset_key)
    if not bindings:
        raise ValueError('Explicit neutral candidate policy cannot have an empty asset inventory')
    return assets, bindings
