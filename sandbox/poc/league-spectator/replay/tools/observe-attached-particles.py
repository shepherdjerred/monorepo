"""Observe complete native attached-emitter pool frames under declared inputs."""
import argparse,json,struct
from pathlib import Path
from attached_particle_native import NativeAttachedParticles
from vfx_spawn_native import sha,ADDRESSES as A

IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
TURNED=[0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1]


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:p.add_argument(name,type=Path)
    a=p.parse_args();cache=a.cache.resolve();decoder=cache/'public/decoder-16.21-macos';directory=cache/'public/latest-attached-particles'
    meta_raw=(directory/'package.json').read_bytes();meta=json.loads(meta_raw)
    for name,h in meta['compilerSources'].items():
        if sha(Path(__file__).with_name(name).read_bytes())!=h:raise ValueError('Attached particle compiler changed')
    times=[0,0,1/60,.05,.1,.2,.3,.5,.7,1,1.2,2,3,4,5,6]
    cases=[];blocks={};count={'graphs':0,'cases':0,'frames':0,'births':0,'liveGraphs':0,'assetPreservationChecks':0};writes=set()
    import unicorn
    active=[False];n=None
    def write(uc,kind,at,size,value,user):
        if active[0]:writes.add((at-n.base,size))
    for index,ref in enumerate(meta['templates']):
        if index%60==0:
            n=NativeAttachedParticles(decoder,a.client);n.u.hook_add(unicorn.UC_HOOK_MEM_WRITE,write,begin=n.base,end=n.base+len(n.image)-1)
        b=(directory/ref['file']).read_bytes()
        if sha(b)!=ref['sha256']:raise ValueError('Attached particle graph differs')
        graph=json.loads(b);modes=[(0,1,0)]
        if ref['effectId']=='champions/viego/43/4f77a64e':modes += [(1,987654321,0),(2,0xffffffffffffffff,3)]
        had_birth=False
        for mode,seed,quality in modes:
            active[0]=True
            try:n.reset_bound(graph,seed,quality,meta)
            finally:active[0]=False
            frames=[];previous=[0,0,0]
            for tick,time in enumerate(times):
                current=[time*130,250+time*3,time*70]if mode==1 else[0,0,0]
                inp={'time':time,'previous':previous,'current':current,'basis':TURNED if mode==2 and tick>=4 else IDENTITY,'viewPosition':[0,0,1000]}
                active[0]=True
                try:state=n.frame_attached(inp);draw_values=n.draw_values()
                except Exception as error:raise ValueError(f"Attached pool {ref['effectId']}:{ref['emitterIndex']} mode {mode} time {time}: {error}")from error
                finally:active[0]=False
                had_birth |= bool(state['births']);count['frames']+=1;count['births']+=len(state['births'])
                frames.append({'input':inp,'state':state,'drawValues':draw_values,'libraryInputs':list(n.library_inputs)});previous=current
                obj=bytes(n.u.mem_read(A['definition'],0x470));heap=bytes(n.u.mem_read(graph['assetHeapStart'],graph['assetHeapBytes']))
                if obj.hex()!=graph['assetObjectHex']or heap.hex()!=graph['segments'][1]['bytesHex']:raise ValueError('Attached pool update changed authored bytes')
                count['assetPreservationChecks']+=1
            cases.append({'graphSha256':ref['sha256'],'effectId':ref['effectId'],'emitterIndex':ref['emitterIndex'],'mode':mode,'seedHex':f'{seed:016x}','quality':quality,'frames':frames});count['cases']+=1
        count['graphs']+=1;count['liveGraphs']+=had_birth
        for block in n.blocks.values():blocks[(block['rva'],block['size'])]=block
        if(index+1)%30==0:print(json.dumps(count),flush=True)
    unexpected=[v for v in writes if not 0x2516698<=v[0]<=0x25166a0-v[1]]
    if unexpected:raise ValueError(f'Unadmitted attached frame image writes: {unexpected[:5]}')
    result={'schema':1,'kind':'native-attached-particle-observations','packageSha256':sha(meta_raw),'observerSha256':sha(Path(__file__).read_bytes()),
        'compilerSources':meta['compilerSources'],'originalBlocks':[blocks[k]for k in sorted(blocks)],'executableGlobalWrites':sorted(writes),'cases':cases,'counts':count,
        'scope':{**meta['scope'],'nativeFramesObserved':True,'originalFrameCadenceVerified':False,'recordedSeedRecovered':False}}
    (cache/'research/attached-particles-native.json').write_text(json.dumps(result,separators=(',',':'),allow_nan=False),encoding='utf-8');print(json.dumps(count),flush=True)


if __name__=='__main__':main()
