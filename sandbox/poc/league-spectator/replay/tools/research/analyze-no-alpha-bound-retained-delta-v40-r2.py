import hashlib,json,struct
from pathlib import Path
root=Path(__file__).resolve().parents[6]
path=root/'.cache/replay-spike/research/no-alpha-mult-stream-raster-v40.json'
data=path.read_bytes(); report=json.loads(data)
f=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
bits=lambda x:struct.pack('<f',x).hex()
rows=[]
for source in report['rows']:
    previous=[],[]
    prior_count=0;delta_bad=[];center_bad=[];checked=0
    previous_deltas=[]
    for frame in source['frames']:
        vector=frame['output']['state']['vectors']['particle'];p=bytes.fromhex(vector['hex'])
        step=[f(f(a)-f(b)) for a,b in zip(frame['input']['current'],frame['input']['previous'])]
        deltas=[]
        for i in range(vector['count']):
            birth=struct.unpack_from('<3f',p,i*0xac+0x30)
            actual_delta=struct.unpack_from('<3f',p,i*0xac+0x9c)
            actual_center=struct.unpack_from('<3f',p,i*0xac+0x80)
            if i<prior_count:
                expected_delta=[f(previous_deltas[i][lane]+step[lane]) for lane in range(3)]
            else: expected_delta=[0,0,0]
            for lane in range(3):
                checked+=1
                if bits(expected_delta[lane])!=bits(actual_delta[lane]):
                    delta_bad.append({'time':frame['input']['time'],'particle':i,'lane':lane,'expected':expected_delta[lane],'actual':actual_delta[lane]})
                expected_center=f(birth[lane]+actual_delta[lane])
                if bits(expected_center)!=bits(actual_center[lane]):
                    center_bad.append({'time':frame['input']['time'],'particle':i,'lane':lane,'birth':birth[lane],'delta':actual_delta[lane],'expected':expected_center,'actual':actual_center[lane]})
            deltas.append(actual_delta)
        previous_deltas=deltas;prior_count=vector['count']
    rows.append({'materialKey':source['materialKey'],'checkedLanes':checked,'retainedDeltaMismatches':delta_bad,'birthPlusRetainedDeltaCenterMismatches':center_bad})
out=root/'.cache/replay-spike/research/no-alpha-mult-bound-retained-delta-v40-r2.json'
if out.exists():raise ValueError('Preserve prior evidence')
result={'schema':1,'kind':'native-retained-bind-delta-arithmetic-localization','inputs':{str(path):hashlib.sha256(data).hexdigest(),str(Path(__file__).resolve()):hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},'rows':rows,'scope':{'hypothesesComparedAgainstActualNativePoolBytes':True,'productionChanged':False,'instructionOrderEstablished':False}}
out.write_text(json.dumps(result,indent=2))
print(json.dumps({'output':str(out),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'rows':[{'materialKey':r['materialKey'],'lanes':r['checkedLanes'],'deltaErrors':len(r['retainedDeltaMismatches']),'centerErrors':len(r['birthPlusRetainedDeltaCenterMismatches']),'firstDelta':r['retainedDeltaMismatches'][:1],'firstCenter':r['birthPlusRetainedDeltaCenterMismatches'][:1]}for r in rows]}))
