"""Validate the original sampler descriptor against its owned GLES projection.

Only the existing non-comparison, non-border, unit-anisotropy device capability
is admitted. Unsupported settings fail before resource publication.
"""
import struct
from unicorn import x86_const as r


def capture_sampler_arguments(n):
    u=n.u;stack=u.reg_read(r.UC_X86_REG_RSP)
    values=[u.reg_read(register) for register in [r.UC_X86_REG_RSI,r.UC_X86_REG_RDX,r.UC_X86_REG_RCX,r.UC_X86_REG_R8,r.UC_X86_REG_R9]]
    mag,compare,compare_mode,anisotropy=[n.q(stack+offset) for offset in [8,16,24,32]]
    if any(value>255 for value in [*values,mag,anisotropy]) or compare>0xffffffff or compare_mode!=1:
        raise ValueError('Unsupported original sampler device argument capability')
    raw=bytearray(16);raw[:3]=bytes(values[:3]);struct.pack_into('<I',raw,4,compare)
    raw[8:12]=bytes([values[3],values[4],mag,anisotropy])
    return {'descriptorHex':raw.hex(),'originalCompareModeArgument':compare_mode}


def compare_sampler_projection(raw,fields,gpu):
    required={'setSAddressMode:','setTAddressMode:','setRAddressMode:','setMinFilter:','setMagFilter:','setMipFilter:','setCompareFunction:','setBorderColor:'}
    if len(raw)!=16 or set(fields)!=required or fields['setCompareFunction:']!=0 or fields['setBorderColor:']!=0:
        raise ValueError('Unsupported original Metal sampler field capability')
    if any(raw[index] for index in [3,4,5,6,7,12,13,14,15]) or raw[11]!=1:
        raise ValueError('Unsupported original sampler compare/anisotropy/reserved bytes')
    modes={0:0x812f,2:0x2901,3:0x8370}
    if any(fields[name] not in modes for name in ['setSAddressMode:','setTAddressMode:','setRAddressMode:']) or any(fields[name] not in [0,1] for name in ['setMinFilter:','setMagFilter:']) or fields['setMipFilter:'] not in [0,1,2]:
        raise ValueError('Unsupported original sampler address/filter capability')
    expected={token:modes[fields[name]] for token,name in [(0x2802,'setSAddressMode:'),(0x2803,'setTAddressMode:'),(0x8072,'setRAddressMode:')]}
    expected[0x2801]=[[0x2600,0x2601],[0x2700,0x2701],[0x2702,0x2703]][fields['setMipFilter:']][fields['setMinFilter:']]
    expected[0x2800]=[0x2600,0x2601][fields['setMagFilter:']]
    if gpu['parameters']!=expected or gpu['queriedParameters']!=expected:
        raise ValueError('Actual GLES sampler differs from original Metal setters')
    return expected
