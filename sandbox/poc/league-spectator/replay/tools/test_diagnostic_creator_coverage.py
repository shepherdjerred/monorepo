import unittest
import hashlib
import json
from pathlib import Path
from diagnostic_creator_coverage import decoded_hero_owners, raster_identity, summarize_raster_ownership


class CreatorCoverageTests(unittest.TestCase):
    def draw(self, **changes):
        return {'sourceEventId':'event:1','generation':1,'definitionId':'champions/hecarim/0/aabbccdd',
                'emitterId':3,'ownerId':7,
                'ownershipStatus':'decoded-cast-owner-under-direct-missile-family-policy',**changes}

    def test_decoded_owner_is_independent_of_asset_family(self):
        row=raster_identity(self.draw(),{7:'Vladimir'})
        self.assertEqual(row['creatorChampion'],'Vladimir')
        self.assertEqual(row['assetFamily'],'champions/hecarim')

    def test_missing_creator_never_uses_asset_family(self):
        row=raster_identity(self.draw(ownerId=None,ownershipStatus='network-creator-unresolved'),{7:'Vladimir'})
        self.assertIsNone(row['creatorChampion'])
        self.assertEqual(row['creatorAttribution'],'creator-unresolved')

    def test_generations_and_positive_coverage_stay_distinct(self):
        rows=[{**raster_identity(self.draw(generation=i),{7:'Vladimir'}),'pixels':1 if i==1 else 0} for i in [1,2]]
        result=summarize_raster_ownership(rows,'pixels')
        self.assertEqual(result['byCreatorChampion']['Vladimir']['submittedInstances'],2)
        self.assertEqual(result['byCreatorChampion']['Vladimir']['positiveInstances'],1)
        self.assertEqual(result['unresolvedCreators']['submittedDraws'],0)

    def test_unverified_policy_rejected_even_for_known_hero(self):
        with self.assertRaises(ValueError):
            raster_identity(self.draw(ownershipStatus='supplied'),{7:'Vladimir'})

    def test_selected_session_owners_require_exact_report_control_and_catalog(self):
        path = Path('unit-selected-report.json').resolve()
        control_path = Path('unit-selected-control.json').resolve()
        report = {'build':'16.21.829.8620','protocol':'20e09df23c66b85e',
                  'heroes':[{'entityId':7,'champion':'Sona'}]}
        report_bytes = json.dumps(report).encode()
        report_hash = hashlib.sha256(report_bytes).hexdigest()
        catalog = {'catalogSha256':'a'*64}
        control = {'kind':'actual-selected-ordinary-reconstruction-control',
                   'scope':{'actualModuleWorker':True,'ordinaryReconstructionFunction':True},
                   'reportPath':str(path),'reportSha256':report_hash,'catalog':catalog}
        control_bytes = json.dumps(control).encode()
        control_hash = hashlib.sha256(control_bytes).hexdigest()
        proof = {'kind':'actual-ordinary-direct-session-playback-capture',
                 'decodedReport':{'path':str(path),'sha256':report_hash},
                 'reconstructionControl':{'path':str(control_path),'sha256':control_hash},
                 'inputs':{str(path):report_hash,str(control_path):control_hash},
                 'selectedStaticCatalog':catalog.copy()}
        raw = lambda p: {path:report_bytes,control_path:control_bytes}[p]
        self.assertEqual(decoded_hero_owners(proof,'.',raw),{7:'Sona'})
        proof['selectedStaticCatalog']['catalogSha256'] = 'b'*64
        with self.assertRaisesRegex(ValueError,'exact selected reconstruction control'):
            decoded_hero_owners(proof,'.',raw)
        proof['selectedStaticCatalog'] = catalog.copy()
        proof['decodedReport']['sha256'] = 'b'*64
        with self.assertRaisesRegex(ValueError,'exact selected reconstruction control'):
            decoded_hero_owners(proof,'.',raw)


if __name__=='__main__':unittest.main()
