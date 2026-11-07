"""Original static material fragments with explicit supplied scalar/object inputs.

No shader selection, constructor, resource acquisition, or replay admission.
"""
import argparse
import json
import inspect
from pathlib import Path
import struct
from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import ADDRESSES as A, sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path)
    parser.add_argument('client',type=Path)
    args=parser.parse_args()
    cache=args.cache.resolve(); decoder=cache/'public/decoder-16.21-macos'
    bound_raw=(decoder/'vfx-bound-quads.json').read_bytes(); bound=json.loads(bound_raw)
    profile_raw=(decoder/'profile.json').read_bytes(); profile=json.loads(profile_raw)
    if sha(bound_raw)!=profile['vfxBoundQuadsSha256']: raise ValueError('Selected bound source package differs')
    seed=None
    for ref in bound['templates']:
        raw=(decoder/ref['file']).read_bytes()
        if sha(raw)!=ref['sha256']: raise ValueError('Seed graph hash differs')
        graph=json.loads(raw)
        if struct.unpack_from('<Q',bytes.fromhex(graph['assetObjectHex']),0x38)[0]==0:
            seed=(ref,raw,graph);break
    if seed is None:raise ValueError('Original nonerosion seed required')
    ref,seed_raw,graph=seed
    eps=struct.unpack('<f',struct.pack('<f',1e-8))[0]
    controls=[]
    for atlas in [(1.,1.),(4.,2.),(0.,0.),(-0.,-0.),(-2.,.5),(3.,7.)]:
        for mult in [None,(1.,1.,0),(2.,4.,2)]:controls.append({'label':'atlas','atlas':atlas,'mult':mult})
    for kind in [-1,0,1,2,3,127]:
        for soft in [(0.,2.,.5,4.),(-0.,0.,eps,eps),(1.,-2.,-.5,0.),(1.,-0.,-0.,-0.)]:controls.append({'label':'soft','soft':[*soft,kind]})
    for address in range(4):
        for pixelated in [0,1]:
            for mult_address in range(4):controls.append({'label':'sampler','address':address,'pixelated':pixelated,'mult':(1.,1.,mult_address)})
    if len(controls)>100:raise ValueError('Native engine cohort exceeds existing100 limit')
    n=NativeVfxMaterial(decoder,args.client)
    cases=[]
    for index,control in enumerate(controls):
        n.prepare_material(graph)
        n.put(A['definition']+0x30,'Q',0);n.put(A['definition']+0x38,'Q',0);n.put(A['definition']+0x230,'Q',0)
        atlas=control.get('atlas',(1.,1.));n.put(A['definition']+0x8c,'ff',*atlas)
        n.put(A['definition']+0x33c,'f',-0. if index%2 else -2.25)
        n.put(A['definition']+0x12,'B',control.get('pixelated',0));n.put(A['definition']+0xc9,'B',control.get('address',0))
        extra=[]
        for offset,size,values in [(0x230,0xa8,control.get('mult')),(0x30,0x18,control.get('soft'))]:
            if values is None:continue
            at=(n.next_heap+15)&~15;n.next_heap=at+size;n.u.mem_write(at,bytes(size));n.put(A['definition']+offset,'Q',at)
            if offset==0x230:n.put(at+0x10,'ffB',*values)
            else:n.put(at,'ffffb',*values)
            extra.append({'address':at,'bytesHex':bytes(n.u.mem_read(at,size)).hex()})
        root=bytes(n.u.mem_read(A['definition'],0x470))
        source={'addresses':{'definition':A['definition']},'assetObjectHex':root.hex(),
                'segments':[{'address':A['definition'],'bytesHex':root.hex()},*extra]}
        parameters=n.parameters();samplers=n.samplers()
        cases.append({'index':index,'control':control,'graph':source,'output':{'parameters':parameters,'samplers':samplers,'erosionAtSuppliedDrive':None,'erosionParameters':[]}})
    sources={str(Path(__file__).resolve()):sha(Path(__file__).read_bytes())}
    for path in {Path(inspect.getfile(cls)) for cls in NativeVfxMaterial.__mro__ if cls is not object}|{Path(__file__).with_name('macho.py')}:
        sources[str(path.resolve())]=sha(path.read_bytes())
    blocks=sorted(n.material_blocks.values(),key=lambda b:b['rva'])
    constants=[]
    for at,size in [(0x20ecad0,16),(0x20ca4a8,4),(0x20dfe10,16),(0x20cadec,4),(0x20ecaa0,4),(0x20ecf84,48)]:
        constants.append({'rva':at,'size':size,'bytesHex':n.image[at:at+size].hex(),'sha256':sha(n.image[at:at+size])})
    result={'schema':1,'kind':'original-static-material-parameter-sampler-controls','build':profile['clientVersion'],'protocol':profile['protocolDigest'],
            'inputs':{str((decoder/'profile.json').resolve()):sha(profile_raw),str((decoder/'vfx-bound-quads.json').resolve()):sha(bound_raw),str((decoder/ref['file']).resolve()):sha(seed_raw),str((decoder/'image.bin').resolve()):sha(n.image),str(args.client.resolve()):sha(args.client.read_bytes()),**sources},
            'entrypoints':{'atlas':[0x16de93f,0x16dea09],'pushPull':[0x16deec2,0x16def04],'soft':[0x16def04,0x16df040],'samplers':[0x16e3910,0x16e3a53]},
            'originalBlocks':blocks,'originalConstants':constants,'cases':cases,
            'scope':{'suppliedSerializedObjectInputs':True,'originalParameterSettersAndInterning':True,'shaderSelection':False,'originalConstructor':False,'authoredSourceLowering':False,'resourceAcquisition':False,'replayAdmission':False,'gpuSubmission':False}}
    path=cache/'research/selected-material-vectors-native.json';path.write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf8')
    print(json.dumps({'path':str(path),'cases':len(cases),'blocks':len(blocks)}))

if __name__=='__main__':main()
