import unittest
from original_sampler_gpu import compare_sampler_projection


class OriginalSamplerProjectionTests(unittest.TestCase):
    def setUp(self):
        self.raw=bytes.fromhex('01010100000000000100010100000000')
        self.fields={'setSAddressMode:':0,'setTAddressMode:':0,'setRAddressMode:':0,'setMinFilter:':1,'setMagFilter:':1,'setMipFilter:':0,'setCompareFunction:':0,'setBorderColor:':0}
        self.parameters={0x2800:0x2601,0x2801:0x2601,0x2802:0x812f,0x2803:0x812f,0x8072:0x812f}
        self.gpu={'parameters':dict(self.parameters),'queriedParameters':dict(self.parameters)}

    def test_actual_original_shared_descriptor_matches_queried_gpu_state(self):
        self.assertEqual(compare_sampler_projection(self.raw,self.fields,self.gpu),self.parameters)

    def test_rejects_missing_extra_and_unsupported_native_fields(self):
        cases=[{key:value for key,value in self.fields.items() if key!='setMinFilter:'},{**self.fields,'setMaxAnisotropy:':2},{**self.fields,'setBorderColor:':1},{**self.fields,'setCompareFunction:':7},{**self.fields,'setSAddressMode:':5},{**self.fields,'setMipFilter:':3}]
        for fields in cases:
            with self.subTest(fields=fields),self.assertRaises(ValueError):compare_sampler_projection(self.raw,fields,self.gpu)

    def test_rejects_actual_gpu_query_disagreement(self):
        for field in ['parameters','queriedParameters']:
            forged={**self.gpu,field:{**self.parameters,0x2802:0x2901}}
            with self.subTest(field=field),self.assertRaisesRegex(ValueError,'differs from original'):compare_sampler_projection(self.raw,self.fields,forged)

    def test_rejects_unadmitted_reserved_compare_and_anisotropy_bytes(self):
        for index in [3,4,5,6,7,11,12,13,14,15]:
            forged=bytearray(self.raw);forged[index]=2
            with self.subTest(index=index),self.assertRaises(ValueError):compare_sampler_projection(bytes(forged),self.fields,self.gpu)


if __name__=='__main__':unittest.main()
