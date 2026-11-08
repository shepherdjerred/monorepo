"""Bounded original registration/default/field/postload controls; no admission."""
import argparse
import json
import struct
from pathlib import Path
import capstone
import unicorn
from unicorn import x86_const as r
from vfx_postload_native import NativeVfxPostload
from vfx_asset_native import OBJECT, ROOT_TYPE
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    package = cache / 'public/decoder-16.21-macos'
    n = NativeVfxPostload(package, args.client)
    root = n.type_catalog[f'{ROOT_TYPE:08x}']
    metadata = json.loads((package / 'vfx-assets.json').read_bytes())
    if root != metadata['types'][f'{ROOT_TYPE:08x}']:
        raise ValueError('Original registered root metadata differs')
    # Complete conservative material read spans requested by the source audit.
    spans = [(0x11, 1), (0x14, 1), (0x72, 2), (0x75, 0x13), (0xc8, 1), (0x2d0, 4)]
    watched = {at for start, size in spans for at in range(start, start + size)}
    properties = [p for p in root['properties'] if p['offset'] in watched]
    defaults = n.load([])
    default_bytes = bytes.fromhex(defaults['objectHex'])
    rows, writes = [], []
    active = {'case': None}
    def write(_uc, _kind, address, size, value, _user):
        if n.postloading and any(address <= OBJECT + at < address + size for at in watched):
            writes.append({'case': active['case'], 'rva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                           'offset': address-OBJECT, 'size': size, 'value': value})
    hook = n.u.hook_add(unicorn.UC_HOOK_MEM_WRITE, write, begin=OBJECT, end=OBJECT+0x46f)
    try:
        for prop in properties:
            typ = prop['type']
            if typ in (1, 135): values = [(bytes([v]), v) for v in (0, 1)]
            elif typ == 3: values = [(bytes([v]), v) for v in (0, 1, 3, 255)]
            elif typ == 10: values = [(struct.pack('<f', v), v) for v in (-3.5, -0.0, 0.0, 2.25)]
            elif typ == 11: values = [(struct.pack('<ff', *v), list(v)) for v in ((0.0, -0.0), (2.25, -3.5))]
            elif typ == 17: values = [(struct.pack('<I', v), v) for v in (0, 0x12345678)]
            else: raise ValueError(f'Unproved material field type {typ:x}')
            for encoded, supplied in values:
                key = f"{prop['hash']:08x}:{encoded.hex()}"
                active['case'] = key
                before = n.load([struct.pack('<IB', prop['hash'], typ) + encoded])
                if before['ignored'] or before['mismatched']:
                    raise ValueError('Controlled property was not consumed by its registered reader')
                obj = bytes.fromhex(before['objectHex'])
                offset = prop['offset']
                if typ == 135:
                    expected = (default_bytes[offset] & ~prop['mask']) | (prop['mask'] if supplied else 0)
                    if obj[offset] != expected: raise ValueError('Original boolean mask reader differs')
                elif obj[offset:offset+len(encoded)] != encoded:
                    raise ValueError('Original scalar/vector field bytes differ')
                after = n.postload()
                final = bytes.fromhex(after['objectHex'])
                n.restore_preload_arena()
                if any(obj[at] != final[at] for at in watched):
                    raise ValueError('Controlled original postload changed a material read span')
                rows.append({'key':key,'property':prop,'supplied':supplied,
                             'loadedHex':obj[offset:offset+(1 if typ==135 else len(encoded))].hex(),
                             'postloadRootCurvePointer':struct.unpack_from('<Q',obj,0x380)[0],
                             'postloadVisits':after['visits']})
    finally:
        n.u.hook_del(hook)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    source_ranges = [('constructor',0x16ffef0,0x1700700),('rootPostload',0x178d920,0x178d9a7),
                     ('recursiveWalker',0x14bc490,0x14bc830)]
    sources = []
    for name, start, end in source_ranges:
        raw = n.image[start:end]
        sources.append({'name':name,'rva':start,'size':len(raw),'sha256':sha(raw),
                        'instructions':[{'rva':i.address,'mnemonic':i.mnemonic,'operands':i.op_str}
                                        for i in md.disasm(raw,start)]})
    children = []
    for offset in (0x30,0x38,0x40,0x48,0x230):
        prop = next(p for p in root['properties'] if p['offset']==offset)
        address = n.base + prop['referencedTypeRva']
        callback = n.q(address+0x30)
        children.append({'rootOffset':offset,'type':n.u32(address+8),'descriptorRva':prop['referencedTypeRva'],
                         'ownCallbackRva':callback-n.base if callback else None})
    inputs = {str(p.resolve()):sha(p.read_bytes()) for p in [Path(__file__),
        Path(__file__).with_name('vfx_asset_native.py'),Path(__file__).with_name('vfx_postload_native.py'),
        Path(__file__).with_name('vfx_spawn_native.py'),Path(__file__).with_name('animation_rig_native.py'),
        package/'profile.json',package/'image.bin',package/'vfx-assets.json']}
    result = {'schema':1,'kind':'original-material-source-field-controls','inputs':inputs,
              'rootType':root,'properties':properties,'defaultObjectHex':default_bytes.hex(),
              'watchedSpans':[{'offset':at,'size':size,'defaultHex':default_bytes[at:at+size].hex()} for at,size in spans],
              'cases':rows,'watchedPostloadWrites':writes,'directMaterialChildren':children,
              'sourceRanges':sources,'originalBlocks':list(n.blocks.values()),
              'scope':{'admissionEstablished':False,'nativePropertyLoading':True,'controlledPostloadOnly':True,
                       'arbitraryCurveVirtualTargetWriteClosureEstablished':False,
                       'nestedMaterialWriteClosureEstablished':False,'observedCases':len(rows)}}
    output = cache/'research/selected-material-source-fields-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'cases':len(rows),'properties':len(properties),'watchedPostloadWrites':len(writes),
                      'directMaterialChildCallbacks':children,'output':str(output),'sha256':sha(output.read_bytes())}))


if __name__ == '__main__': main()
