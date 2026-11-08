"""Original no-dynamics worldAcceleration branch; no material admission."""
import argparse,json,struct
from pathlib import Path
from vfx_postload_native import NativeVfxPostload
from vfx_asset_native import OBJECT,ROOT_TYPE
from vfx_spawn_native import sha

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);p.add_argument('client',type=Path);a=p.parse_args()
    cache=a.cache.resolve();package=cache/'public/decoder-16.21-macos';n=NativeVfxPostload(package,a.client)
    root=n.type_catalog[f'{ROOT_TYPE:08x}'];field=next(x for x in root['properties']if x['offset']==0x370)
    derived=n.type_catalog['6ccc7f03'];base=n.type_catalog['68dc32b6'];constant=next(x for x in base['properties']if x['offset']==0)
    if field['hash']!=0xeb9a4e0f or field['type']!=131 or constant['type']!=12:raise ValueError('Original integrated vector source registration differs')
    rows=[]
    for values in [None,[],[0.0,-0.0,0.0],[1.25,-3.5,2.0]]:
        raw=[]
        if values is not None:
            body=b'' if not values else struct.pack('<IBfff',constant['hash'],constant['type'],*values)
            raw=[struct.pack('<IBIIH',field['hash'],field['type'],0x6ccc7f03,2+len(body),int(bool(body)))+body]
        n.load(raw)
        if n.ignored or n.mismatched:raise ValueError('Original integrated vector source reader skipped input')
        before=bytes(n.u.mem_read(OBJECT+0x370,24));expected=bytes(12)if not values else struct.pack('<fff',*values)
        if before[:12]!=expected or n.q(OBJECT+0x380)!=0:raise ValueError('Original no-dynamics integrated value differs')
        after=n.postload();final=bytes(n.u.mem_read(OBJECT+0x370,24));n.restore_preload_arena()
        if final!=before:raise ValueError('Original no-dynamics integrated value postload changed')
        rows.append({'source':'absent'if values is None else'empty-class'if not values else'constant-only','value':values,'objectHex':before.hex(),'postloadVisits':after['visits']})
    primitive_field=next(x for x in root['properties']if x['offset']==0x60)
    primitive_cases=[]
    for klass,code,vtable in[(None,0,0x23f23b0),(0x4beb81fd,1,0x23f20c8)]:
        raw=[] if klass is None else[struct.pack('<IBIIH',primitive_field['hash'],primitive_field['type'],klass,2,0)]
        n.load(raw)
        if n.ignored or n.mismatched:raise ValueError('Original primitive field reader skipped input')
        child=n.q(OBJECT+0x60)
        if bytes(n.u.mem_read(child+8,1))!=bytes([code]) or n.q(child)-n.base!=vtable:raise ValueError('Original primitive class/bytecode/vtable differs')
        before=bytes(n.u.mem_read(child,24));after=n.postload();final=bytes(n.u.mem_read(child,24));n.restore_preload_arena()
        if before!=final:raise ValueError('Original primitive postload differs')
        primitive_cases.append({'source':'absent-default'if klass is None else'exact-empty-arbitrary-class','type':klass,'code':code,'vtableRva':vtable,'objectHex':before.hex(),'postloadVisits':after['visits']})
    paths=[Path(__file__),*[Path(__file__).with_name(x)for x in('vfx_asset_native.py','vfx_postload_native.py','vfx_spawn_native.py','animation_rig_native.py')],package/'profile.json',package/'image.bin',package/'vfx-assets.json']
    report={'schema':1,'kind':'original-no-dynamics-world-acceleration-controls','inputs':{str(x.resolve()):sha(x.read_bytes())for x in paths},'field':field,'derivedClass':derived,'baseClass':base,'constantField':constant,'cases':rows,'primitiveField':primitive_field,'primitiveCases':primitive_cases,'originalBlocks':list(n.blocks.values()),'scope':{'originalFieldLoadingAndPostload':True,'dynamicCurveBehavior':False,'runtimeAdmission':False}}
    out=cache/'research/material-empty-world-acceleration-native.json';out.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({'cases':len(rows),'primitiveCases':len(primitive_cases),'sha256':sha(out.read_bytes()),'output':str(out)}))

if __name__=='__main__':main()
