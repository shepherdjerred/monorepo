"""Original numeric material child constructors/readers; controlled postload only."""
import argparse
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from vfx_postload_native import NativeVfxPostload
from vfx_asset_native import OBJECT, ROOT_TYPE
from vfx_spawn_native import sha


def samples(typ):
    if typ == 1: return [(bytes([v]), bool(v)) for v in (0, 1)]
    if typ == 3: return [(bytes([v]), v) for v in (0, 1, 3, 255)]
    if typ == 10: return [(struct.pack('<f', v), v) for v in (-3.5, -0.0, 0.0, 2.25)]
    if typ == 11: return [(struct.pack('<ff', *v), list(v)) for v in ((0.0, -0.0), (2.25, -3.5))]
    raise ValueError('Unproved numeric source field type')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    package = cache/'public/decoder-16.21-macos'
    n = NativeVfxPostload(package, args.client)
    root = n.type_catalog[f'{ROOT_TYPE:08x}']
    declared = json.loads((package/'vfx-assets.json').read_bytes())
    for key in ('09cde442','1daa3fb0','b097c1bd'):
        if n.type_catalog[key] != declared['types'][key]: raise ValueError('Original source registration differs')
    cases, objects, writes = [], [], []
    ranges = []
    active = {'key':None,'address':None,'size':None}
    def observe(_uc,_kind,address,size,value,_user):
        start=active['address']
        if n.postloading and start is not None and address < start+active['size'] and address+size > start:
            writes.append({'key':active['key'],'rva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,'offset':address-start,'size':size,'value':value})
    hook=n.u.hook_add(unicorn.UC_HOOK_MEM_WRITE,observe,begin=OBJECT,end=0x11ffffff)
    try:
        for offset, klass, selected in [(None,ROOT_TYPE,(0x12,0x8c,0xc9,0x33c)),(0x30,0x1daa3fb0,(0,4,8,12,16)),(0x230,0xb097c1bd,(0x10,0x18))]:
            desc=n.type_catalog[f'{klass:08x}']
            parent=None if offset is None else next(p for p in root['properties'] if p['offset']==offset)
            def load(fields):
                if parent is None:
                    n.load(fields)
                    return OBJECT
                body=b''.join(fields)
                n.load([struct.pack('<IBIIH',parent['hash'],parent['type'],klass,2+len(body),len(fields))+body])
                return n.q(OBJECT+offset)
            obj=load([])
            defaults=bytes(n.u.mem_read(obj,desc['size']))
            properties=[p for p in desc['properties'] if p['offset']in selected]
            callback=n.q(n.types[klass]+0x30)
            objects.append({'rootOffset':offset,'type':klass,'descriptor':desc,'defaultObjectHex':defaults.hex(),
                            'ownCallbackRva':callback-n.base if callback else None,'properties':properties})
            for p in properties:
                for raw,value in samples(p['type']):
                    obj=load([struct.pack('<IB',p['hash'],p['type'])+raw])
                    if n.ignored or n.mismatched:raise ValueError('Original child field reader did not accept supplied field')
                    before=bytes(n.u.mem_read(obj,desc['size']))
                    if before[p['offset']:p['offset']+len(raw)]!=raw:raise ValueError('Original child scalar/vector bytes differ')
                    active.update(key=f'{klass:08x}:{p["hash"]:08x}:{raw.hex()}',address=obj+p['offset'],size=len(raw))
                    after=n.postload()
                    actual=bytes(n.u.mem_read(obj+p['offset'],len(raw)))
                    n.restore_preload_arena()
                    if actual!=raw:raise ValueError('Controlled original postload modified selected numeric field')
                    cases.append({'key':active['key'],'rootOffset':offset,'type':klass,'property':p,'supplied':value,
                                  'loadedHex':actual.hex(),'postloadVisits':after['visits']})
            at=desc['constructRva']
            ranges.append({'type':klass,'constructorRva':at,'constructorEntryBytesHex':n.image[at:at+96].hex()})
    finally:n.u.hook_del(hook)
    paths=[Path(__file__),*[Path(__file__).with_name(p)for p in('vfx_asset_native.py','vfx_postload_native.py','vfx_spawn_native.py','animation_rig_native.py')],package/'profile.json',package/'image.bin',package/'vfx-assets.json']
    report={'schema':1,'kind':'original-material-numeric-child-source-controls','inputs':{str(p.resolve()):sha(p.read_bytes())for p in paths},'objects':objects,'cases':cases,'watchedPostloadWrites':writes,'constructorEntries':ranges,'originalBlocks':list(n.blocks.values()),
            'scope':{'originalRegistrationAndFieldLoading':True,'controlledPostloadOnly':True,'universalNestedCallbackWriteClosure':False,'runtimeAdmission':False}}
    output=cache/'research/selected-material-nested-fields-native.json'
    output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'cases':len(cases),'objects':len(objects),'watchedWrites':len(writes),'sha256':sha(output.read_bytes()),'output':str(output)}))


if __name__=='__main__':main()
