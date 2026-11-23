import json
import tempfile
import unittest
from pathlib import Path
from neutral_argument_corpus import digest, load_neutral_argument_proof, SCHEMA


class CorpusTest(unittest.TestCase):
    def test_original_rows_and_case_insensitive_requests_are_separate(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            code = root/'code.py'
            code.write_bytes(b'original')
            sources = []
            for index, character in enumerate(['Sru_Crab', 'SRU_Crab']):
                file = root/('proof%d.json' % index)
                proof = {key: SCHEMA['properties'][key]['const'] for key in ['schema', 'build', 'protocol', 'decoderImageSha256']}
                proof.update(kind='original-neutral-creation-factory-arguments', boundary=None,
                             replaySha256=str(index+1)*64, scope={'originalArgumentPrefixExecuted': True},
                             sources={str(code): digest(code.read_bytes())}, records=[{'character': character, 'skinId': 0}])
                file.write_text(json.dumps(proof), encoding='utf-8')
                sources.append({'file': str(file), 'sha256': digest(file.read_bytes()), 'replaySha256': proof['replaySha256'], 'records': 1})
            corpus = {key: SCHEMA['properties'][key]['const'] for key in ['schema', 'kind', 'build', 'protocol', 'decoderImageSha256']}
            corpus.update(sources=sources, requests=[{'character': 'sru_crab', 'skinId': 0}])
            file = root/'corpus.json'

            def load():
                file.write_text(json.dumps(corpus), encoding='utf-8')
                return load_neutral_argument_proof(file)

            result = load()
            self.assertEqual([row['character'] for row in result['records']], ['Sru_Crab', 'SRU_Crab'])
            self.assertEqual(result['requests'], corpus['requests'])
            for mutate, restore in [
                (lambda: corpus['requests'][0].update(skinId=False), lambda: corpus['requests'][0].update(skinId=0)),
                (lambda: corpus['requests'].clear(), lambda: corpus.update(requests=[{'character': 'sru_crab', 'skinId': 0}])),
                (lambda: sources[1].update(replaySha256=sources[0]['replaySha256']), lambda: sources[1].update(replaySha256='2'*64)),
                (lambda: code.write_bytes(b'changed'), lambda: code.write_bytes(b'original')),
            ]:
                mutate()
                with self.assertRaises(ValueError):
                    load()
                restore()
            self.assertEqual(len(load()['proofs']), 2)


if __name__ == '__main__':
    unittest.main()
