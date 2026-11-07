"""Original FixedSpeed spell reader and creation/live/stopped VFX basis controls.

Uses the exact authored AkshanEMissile record as a source fixture. Supplied
velocity samples isolate the shared direction callback; no endpoint range,
native replay motion, model readiness or active family admission is inferred.
"""
import argparse
import io
import json
from pathlib import Path
import struct
import sys
import importlib.util
import cdtb.binfile as binfile
from unicorn import x86_const as r
from vfx_spawn_native import sha

_spec=importlib.util.spec_from_file_location('replay_fixed_time_basis_control',Path(__file__).with_name('probe-missile-effect-basis.py'))
_module=importlib.util.module_from_spec(_spec)
sys.modules[_spec.name]=_module
_spec.loader.exec_module(_module)
Control=_module.Control


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path)
    parser.add_argument('client',type=Path)
    args=parser.parse_args()
    cache,inputs=args.cache.resolve(),{}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('FixedSpeed basis input changed')
        inputs[str(path)]=digest;return data
    for dictionary in [value for key,value in vars(binfile).items() if key.startswith('hashfile_')]:dictionary.hashes={}
    for dictionary,name in [(binfile.hashfile_binfields,'binfields'),(binfile.hashfile_bintypes,'bintypes')]:
        dictionary.hashes={int(line.split()[0],16):line.split(maxsplit=1)[1].strip() for line in raw(cache/'vfx'/('hashes.'+name+'.txt')).decode().splitlines()}
    data=raw(cache/'installed-assets/16.21.829.8620-6f8712cf8ff0/characters/akshan.bin')
    class Reader(binfile.BinReader):
        def __init__(self,*args):super().__init__(*args);self.spans={}
        def read_field(self,kind):
            start=self.f.tell();field=super().read_field(kind);self.spans[id(field)]=(start,self.f.tell());return field
    stream=io.BytesIO(data)
    if stream.read(4)!=b'PROP':raise ValueError('Original typed spell BIN required')
    reader=Reader(stream);_,_,types=reader.read_binfile_header()
    entries=[reader.read_binfile_entry(kind) for kind in types]
    entry=next(entry for entry in entries for field in entry.fields if str(field.name)=='ObjectName' and field.value=='AkshanEMissile')
    spell=next(field.value for field in entry.fields if str(field.name)=='mSpell')
    n=Control(cache/'public/decoder-16.21-macos',args.client)
    n.initialize_character_types();n.call(0x870ae0,{})
    registry,count=n.q(n.base+0x247b7c0),n.u32(n.base+0x247b7c8)
    n.types={n.u32(n.q(registry+i*8)+8):n.q(registry+i*8) for i in range(count)}
    n.type_catalog=n.catalog()
    metadata=n.type_catalog['43368569']
    turn_fields=[field for field in metadata['properties'] if field['offset'] in [0x440,0x444]]
    spans=[reader.spans[id(field)] for field in spell.fields]
    loaded=n.observe_actor_fields(spell.type.h,[data[a:b] for a,b in spans]);obj=loaded['object']
    if spell.type.h!=0x43368569 or len(turn_fields)!=2 or bytes(n.u.mem_read(obj+0x440,8))!=bytes(8):raise ValueError('Authored FixedSpeed direction smoothing must be absent')
    missile_field=next(field for field in metadata['properties'] if field['hash']==binfile.compute_binhash('mMissileSpec'))
    missile_spec=n.q(obj+missile_field['offset'])
    if not missile_spec or bytes(n.u.mem_read(missile_spec+0x31,1))!=bytes(1):raise ValueError('Untranslated missile visibility producer')
    source_missile=next(field.value for field in spell.fields if str(field.name)=='mMissileSpec')
    source_movement=next(field.value for field in source_missile.fields if str(field.name)=='movementComponent')
    if source_movement.type.h!=binfile.compute_binhash('FixedSpeedMovement'):raise ValueError('Original source movement type must be FixedSpeed')
    missile_metadata=n.type_catalog[f'{source_missile.type.h:08x}']
    movement_field=next(field for field in missile_metadata['properties'] if field['hash']==binfile.compute_binhash('movementComponent'))
    movement_spec=n.q(missile_spec+movement_field['offset'])
    movement_descriptor=n.types[source_movement.type.h]
    default_movement=n.allocate(n.q(movement_descriptor+0x40))
    n.call(n.q(movement_descriptor+0x20)-n.base,{r.UC_X86_REG_RDI:default_movement})
    if n.q(movement_spec)!=n.q(default_movement) or bytes(n.u.mem_read(movement_spec+0xa,1))!=bytes(1):raise ValueError('Original loaded movement class/tracking flag differs')
    movement_evidence={'typeHash':source_movement.type.h,'vtableRva':n.q(movement_spec)-n.base,
                       'mTracksTarget':False,'mSpeed':struct.unpack('<f',n.u.mem_read(movement_spec+0x5c,4))[0]}
    actor,callback,holder,game_object,vfx_object,weak,descriptor,owner=[n.allocate(size) for size in [0x500,0x38,8,0x200,0x238,0x20,0x40,0x100]]
    n.put(weak+8,'q',1);n.put(weak+16,'q',1)
    n.put(holder,'Q',game_object);n.put(game_object+0x178,'Q',vfx_object);n.put(actor+0x3f0,'Q',callback)
    mask=(1<<64)-1
    ror=lambda value,count:((value>>count)|(value<<(64-count)))&mask
    n.put(descriptor+8,'Q',ror(owner^0x3dc9cb21,21))
    def initialize():
        n.call(0x892ea0,{r.UC_X86_REG_RDI:callback,r.UC_X86_REG_RSI:actor})
        n.put(owner+0x80,'Q',(ror(obj,17)-0x80104765)&mask)
        n.fragment(0x892f00,0x892f3c,{r.UC_X86_REG_RDI:callback,r.UC_X86_REG_RDX:descriptor})
        n.put(callback+0x10,'QQ',holder,weak);n.put(actor+0x348,'Q',missile_spec)
        if bytes(n.u.mem_read(callback+0x20,8))!=bytes(8):raise ValueError('Original callback config changed')
    cases=[]
    for velocity in [[1,0,0],[0,0,1],[0,1,0],[0,-1,0],[1,2,3],[-4,-3,-2],[1.25,-3.5,7.75],[0.00001,1,0],[0.001,1,0],[0.01,1,0],[1e-6,0,0]]:
        initialize();samples=[]
        for index,(value,stopped) in enumerate([(velocity,False),([0,0,0],False),(velocity,False),([0,0,0],True)]):
            n.put(actor+0x58,'fff',*value);n.put(actor+0x3c8,'?',stopped)
            if index==0:n.fragment(0x87a869,0x87a8d1,{r.UC_X86_REG_R14:actor})
            else:n.fragment(0x87bb93,0x87bbd9 if stopped else 0x87bbac,{r.UC_X86_REG_RBX:actor})
            samples.append({'inputVelocity':value,'creation':index==0,'stopped':stopped,
                            'direction':list(struct.unpack('<fff',n.u.mem_read(callback,12))),
                            'matrix':list(struct.unpack('<16f',n.u.mem_read(vfx_object+0x120,64))),
                            'matrixHex':bytes(n.u.mem_read(vfx_object+0x120,64)).hex(),
                            'weakOwners':struct.unpack('<q',n.u.mem_read(weak+8,8))[0]})
        cases.append({'initialVelocity':velocity,'samples':samples})
    raw(args.client)
    for name in ['profile.json','image.bin']:raw(cache/'public/decoder-16.21-macos'/name)
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):raw(path)
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('FixedSpeed basis input drifted: '+path)
    output=cache/'research/nontracking-fixed-speed-basis-native-v35.json'
    output.write_text(json.dumps({'schema':1,'kind':'original-nontracking-fixed-speed-source-basis-controls','artifactVersion':35,
        'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'inputs':inputs,
        'sourceSpell':{'name':'AkshanEMissile','entryPathHash':entry.path.h,'typeHash':spell.type.h,
                       'fields':[{'offset':a,'bytes':b-a,'sha256':sha(data[a:b])} for a,b in spans],
                       'allAuthoredFieldsPassedToOriginalReader':True,'originalLoaded':loaded,
                       'originalLoadedMovement':movement_evidence,
                       'turnFields':turn_fields,'turnBytesHex':bytes(n.u.mem_read(obj+0x440,8)).hex()},
        'cases':cases,'blocks':list(n.blocks.values()),'scope':{'originalTypedSourceReader':True,
        'originalCreationLiveAndStoppedCallbacks':True,'fullOriginalDirectionAndVfxSetter':True,
        'suppliedVelocityControls':True,'actualMatchMotionEstablished':False,'actualRangeRecovered':False,
        'activeFamilyAdmissionChanged':False}},indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'samples':sum(len(x['samples']) for x in cases),'blocks':len(n.blocks)}))


if __name__=='__main__':main()
