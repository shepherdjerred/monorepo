"""Creator attribution from retained ownership policy and pinned decoded heroes.

Definition paths describe asset families only and never establish a creator.
"""
import hashlib
import json
from pathlib import Path

OWNERSHIP_POLICIES = {
    'decoded-cast-owner-under-direct-missile-presentation-policy',
    'decoded-cast-owner-under-direct-missile-family-policy',
}


def decoded_hero_owners(proof, cache, raw):
    selected = proof.get('kind') == 'actual-ordinary-direct-session-playback-capture'
    path = (Path(proof['decodedReport']['path']) if selected else
            Path(cache)/'research/viewer-root-reconstruction.json').resolve()
    pins = [digest for name, digest in proof['inputs'].items() if Path(name).resolve() == path]
    data = raw(path)
    if len(pins) != 1 or hashlib.sha256(data).hexdigest() != pins[0]:
        raise ValueError('Worker-pinned ordinary decoded hero identity map required')
    export = json.loads(data)
    if selected:
        control_path = Path(proof['reconstructionControl']['path']).resolve()
        control_bytes = raw(control_path)
        digest = hashlib.sha256(control_bytes).hexdigest()
        control = json.loads(control_bytes)
        if (proof['inputs'].get(str(control_path)) != digest or
                proof['reconstructionControl']['sha256'] != digest or
                control.get('kind') != 'actual-selected-ordinary-reconstruction-control' or
                control['scope'].get('actualModuleWorker') is not True or
                control['scope'].get('ordinaryReconstructionFunction') is not True or
                Path(control['reportPath']).resolve() != path or
                control['reportSha256'] != pins[0] or proof['decodedReport']['sha256'] != pins[0] or
                control['catalog'] != proof.get('selectedStaticCatalog')):
            raise ValueError('Session owner identities require the exact selected reconstruction control')
        report = export
    else:
        if export['kind'] != 'verified-ordinary-reconstruction-diagnostic-export':
            raise ValueError('Ordinary reconstruction diagnostic export required')
        report = export['report']
    if (report['build'] != '16.21.829.8620' or report['protocol'] != '20e09df23c66b85e'):
        raise ValueError('Exact ordinary reconstruction hero identities required')
    result = {}
    for hero in report['heroes']:
        identity, champion = hero['entityId'], hero['champion']
        if (type(identity) is not int or not 0 < identity <= 0xffffffff or identity in result or
                not isinstance(champion, str) or not champion):
            raise ValueError('Unique decoded hero identity/champion required')
        result[identity] = champion
    return result


def raster_identity(draw, heroes):
    owner, status = draw.get('ownerId'), draw.get('ownershipStatus')
    if owner is None:
        if status not in ['network-creator-unresolved', 'unresolved']:
            raise ValueError('Known unresolved creator ownership status required')
        champion, attribution = None, 'creator-unresolved'
    else:
        if type(owner) is not int or not 0 < owner <= 0xffffffff or status not in OWNERSHIP_POLICIES:
            raise ValueError('Verified decoded creator ownership policy required')
        champion = heroes.get(owner)
        attribution = 'decoded-hero-owner' if champion else 'owner-id-not-a-decoded-hero'
    generation = draw['generation']
    if type(generation) is not int or generation < 1:
        raise ValueError('Retained creation generation required')
    return {'sourceEventId': draw['sourceEventId'], 'generation': generation,
            'definitionId': draw['definitionId'], 'emitterId': draw['emitterId'],
            'ownerId': owner, 'ownershipStatus': status, 'creatorChampion': champion,
            'creatorAttribution': attribution, 'assetFamily': '/'.join(draw['definitionId'].split('/')[:2])}


def summarize_raster_ownership(rows, positive_field):
    def counts(values):
        positive = [row for row in values if row[positive_field] > 0]
        return {'submittedDraws': len(values),
            'submittedInstances': len({(r['sourceEventId'],r['generation']) for r in values}),
            'submittedDefinitions': len({r['definitionId'] for r in values}),
            'submittedComponents': len({(r['sourceEventId'],r['generation'],r['emitterId']) for r in values}),
            'positiveDraws': len(positive),
            'positiveInstances': len({(r['sourceEventId'],r['generation']) for r in positive}),
            'positiveDefinitions': len({r['definitionId'] for r in positive}),
            'positiveComponents': len({(r['sourceEventId'],r['generation'],r['emitterId']) for r in positive}),
            'ownershipStatuses': sorted({r['ownershipStatus'] for r in values})}
    return {'byCreatorChampion': {champion: counts([r for r in rows if r['creatorChampion'] == champion])
                for champion in sorted({r['creatorChampion'] for r in rows if r['creatorChampion'] is not None})},
            'unresolvedCreators': counts([r for r in rows if r['creatorChampion'] is None]),
            'byAssetFamily': {family: counts([r for r in rows if r['assetFamily'] == family])
                for family in sorted({r['assetFamily'] for r in rows})},
            'scope': {'creatorRequiresDecodedHeroIdentityAndVerifiedOwnershipPolicy': True,
                      'assetFamilyDoesNotEstablishCreator': True}}
