import unittest
from xxhash import xxh64_intdigest
from shader_permutation import macro_hash, select_permutation


class ShaderPermutationTests(unittest.TestCase):
    def source(self, name='FEATURE', value='1'):
        text = name if not value else name + '=' + value
        return {'baseDefines': [{'name': name, 'value': value, 'hash': macro_hash(name, value)}],
                'permutations': [{'hash': f'{xxh64_intdigest(text):016x}', 'id': 17}]}

    def test_original_macro_hash(self):
        self.assertEqual(macro_hash('USE_THIN_FILM', '0'), '615abcc8')
        self.assertEqual(macro_hash('use_thin_film', '0'), '615abcc8')

    def test_unknown_pair_does_not_poison_an_exact_permutation(self):
        source = self.source()
        source['baseDefines'].append({'name': 'DISABLE_SHADOWS', 'value': '1',
                                      'hash': macro_hash('DISABLE_SHADOWS', '1')})
        result = select_permutation(source, [{'name': 'FEATURE', 'value': '1'},
                                            {'name': 'DISABLE_SHADOWS', 'value': '0'},
                                            {'name': 'UNKNOWN', 'value': '1'}])
        self.assertEqual(result['id'], 17)
        self.assertEqual(result['defines'], [{'name': 'FEATURE', 'value': '1'}])

    def test_unknown_value_does_not_substitute_a_declared_value(self):
        self.assertIsNone(select_permutation(self.source(), [{'name': 'FEATURE', 'value': '0'}])['id'])

    def test_empty_value_has_no_equals_suffix(self):
        self.assertEqual(select_permutation(self.source(value=''), [{'name': 'FEATURE', 'value': ''}])['id'], 17)

    def test_case_insensitive_macro_hash_preserves_case_in_permutation_key(self):
        result = select_permutation(self.source(), [{'name': 'feature', 'value': '1'}])
        self.assertEqual(result['defines'], [{'name': 'feature', 'value': '1'}])
        self.assertIsNone(result['id'])

    def test_duplicate_input_or_permutation_fails(self):
        d = {'name': 'FEATURE', 'value': '1'}
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            select_permutation(self.source(), [d, d])
        source = self.source()
        source['permutations'] *= 2
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            select_permutation(source, [d])

    def test_corrupt_declaration_fails(self):
        source = self.source()
        source['baseDefines'][0]['hash'] = '00000000'
        with self.assertRaisesRegex(ValueError, 'hash differs'):
            select_permutation(source, [])


if __name__ == '__main__':
    unittest.main()
