"""Prepare static exact-build submesh event bindings and native observations."""
import argparse,itertools,json,random,struct
from pathlib import Path
from submesh_visibility_native import NativeSubmeshVisibility,BLOCKS
from vfx_spawn_native import sha,name_hash

def main():
 p=argparse.ArgumentParser(description=__doc__)
 for name in ['cache','client']:p.add_argument(name,type=Path)
 a=p.parse_args();cache=a.cache.resolve();inputs={}
 def raw(path):
  b=path.read_bytes();inputs[str(path.resolve())]=sha(b);return b
 def read(path):return json.loads(raw(path))
 scene_path=cache/'public/latest-scene';scene=read(scene_path/'manifest.json');world=read(scene_path/scene['world'])
 n=NativeSubmeshVisibility(cache/'public/decoder-16.21-macos',a.client);assets={};sequences=[];event_count=0
 allowed={'__type','mName','mStartFrame','mEndFrame','mFireIfAnimationEndsEarly','mShowSubmeshList','mHideSubmeshList','ApplyOnlyToAvatarMeshes'}
 def observe(name,names,specs,clocks,initial=0xffffffff,avatar=0xffffffff):
  beginning=n.reset(names,specs,initial,avatar)
  frames=[{'frame':f,'resync':resync,'output':n.step(f,resync)}for f,resync in clocks]
  sequences.append({'name':name,'names':names,'events':specs,'initial':initial,'avatar':avatar,'beginning':beginning,'frames':frames})
 for actor,asset in [(f'champions/{k}',v)for k,v in scene['champions'].items()]+[(f'world/{k}',v)for k,v in world['assets'].items()if v.get('animationGraph')]:
  graph_raw=raw(scene_path/asset['animationGraph']);graph=json.loads(graph_raw);data=[v for v in graph.values()if isinstance(v,dict)and v.get('__type')=='AnimationGraphData']
  if len(data)!=1:raise ValueError('Ambiguous visibility graph')
  skn_path=Path(asset['model']).with_suffix('.skn');skn=raw(scene_path/skn_path)
  magic,major,minor,count=struct.unpack_from('<IHHI',skn)
  if magic!=0x112233 or(major,minor)not in [(2,1),(4,1)]or not 0<count<=32:raise ValueError('Unsupported SKN range container')
  names=[skn[12+i*80:12+i*80+64].split(b'\0',1)[0].decode('ascii')for i in range(count)]
  model_raw=raw(scene_path/asset['model']);length,kind=struct.unpack_from('<II',model_raw,12)
  if model_raw[:4]!=b'glTF'or kind!=0x4e4f534a:raise ValueError('Unsupported GLB range projection')
  gltf=json.loads(model_raw[20:20+length]);materials=[v['name']for v in gltf['materials']]
  primitives=[p for m in gltf['meshes']for p in m['primitives']]
  if [materials[p['material']]for p in primitives]!=names:raise ValueError('GLB primitive order differs from SKN ranges')
  n.reset(names,[]);ranges=[{'name':name,'hash':name_hash(name),'mask':n.mapping[name],'index':i}for i,name in enumerate(names)]
  clips={};all_clips=list(data[0]['mClipDataMap'])
  for name,clip in data[0]['mClipDataMap'].items():
   events=[]
   for key,event in clip.get('mEventDataMap',{}).items():
    if event.get('__type')!='SubmeshVisibilityEventData':continue
    if set(event)-allowed:raise ValueError('Unknown authored submesh event field')
    spec={'id':key,'startFrame':event.get('mStartFrame',0),'endFrame':event.get('mEndFrame',-1),
      'fireIfEarly':event.get('mFireIfAnimationEndsEarly',False),'avatarOnly':event.get('ApplyOnlyToAvatarMeshes',False),
      'show':event.get('mShowSubmeshList',[]),'hide':event.get('mHideSubmeshList',[])}
    for key2 in ['show','hide']:
     if not isinstance(spec[key2],list)or any(not isinstance(x,str)for x in spec[key2]):raise ValueError('Invalid submesh list')
    events.append(spec);event_count+=1
   if events:
    beginning=n.reset(names,events);masks=[]
    for runtime in n.runtimes:masks.append(list(struct.unpack('<II',n.u.mem_read(runtime+0x28,8))))
    clips[name]={'type':clip['__type'],'events':[{**e,'showMask':m[0],'hideMask':m[1]}for e,m in zip(events,masks)]}
    boundaries=sorted(set([-2,-1,0,1000,*[float(e[k])+d for e in events for k in ['startFrame','endFrame']for d in [-.001,0,.001]]]))
    observe(f'{actor}:{name}',names,events,[(f,False)for f in boundaries]+[(f,True)for f in reversed(boundaries)])
  assets[asset['animationGraph']]={'actor':actor,'graphSha256':sha(graph_raw),'model':asset['model'],'modelSha256':sha(model_raw),
    'skn':str(skn_path).replace('\\','/'),'sknSha256':sha(skn),'ranges':ranges,'allClips':all_clips,'clips':clips,'hidden':asset['hidden']}
 rng=random.Random(0x16218298)
 # Finite, zero-length, inverted and open intervals; sparse frames and resyncs.
 for start,end,avatar in itertools.product([-1,0,2,2.25],[-1,0,1,2,5],[False,True]):
  specs=[{'id':'first','startFrame':start,'endFrame':end,'hide':['BODY','missing'],'show':['duplicate'],'avatarOnly':avatar},
   {'id':'second','startFrame':3,'endFrame':6,'show':['Body'],'hide':['weapon'],'fireIfEarly':True}]
  clocks=[(f,False)for f in [-2,-1,0,1,2,2.25,3,4,5,6,8]]+[(f,True)for f in [8,0,3,-2,2.25,6,1]]
  observe('controlled',['Body','weapon','duplicate','DUPLICATE'],specs,clocks,rng.getrandbits(32),rng.getrandbits(32))
 # Late initial frames and repeated frames expose ordering/cadence dependence.
 for i in range(64):
  specs=[{'id':str(j),'startFrame':rng.choice([-1,0,2,3]),'endFrame':rng.choice([-1,0,2,5]),'hide':rng.sample(['Body','weapon','duplicate'],rng.randrange(4)),
   'show':rng.sample(['Body','weapon','duplicate'],rng.randrange(4)),'avatarOnly':bool(rng.randrange(2))}for j in range(4)]
  observe('mixed',['Body','weapon','duplicate'],specs,[(6,False),(6,False),(0,True),(4,False),(1,True),(8,False)])
 observe('all-32-bits',[f'part{i}'for i in range(32)],[{'id':'highest-bit','startFrame':0,'endFrame':3,'show':['part31'],'hide':['part0']},
  {'id':'avatar','startFrame':1,'hide':['part31'],'avatarOnly':True}],[(f,False)for f in [-1,0,1,2,3,4]]+[(f,True)for f in [0,4]],0,0xffffffff)
 meta={'schema':1,'kind':'native-submesh-visibility','build':scene['build'],'protocol':scene['protocol'],'decoderImageSha256':n.profile['decoderImageSha256'],
  'sliceSha256':n.profile['sliceSha256'],'sceneManifestSha256':inputs[str((scene_path/'manifest.json').resolve())],
  'fieldLayout':n.layout,'baseFieldLayout':n.base_layout,'defaultDataHex':n.defaults.hex(),'assets':assets,
  'sourceBlocks':[{'startRva':x,'endRva':y,'sha256':sha(n.image[x:y])}for x,y in BLOCKS],
  'scope':{'nativeResourceMapConstructorExecuted':True,'nativeEventConstructorExecuted':True,'nativeSchedulerExecuted':True,'nativeMaskSettersExecuted':True,
   'gameCallbacksReplaced':False,'rawSknLoaderExecuted':False,'fullAnimationGraphExecuted':False,'nativeFrameCadenceVerified':False,'graphicsSubmissionExecuted':False,'leagueAvCompared':False}}
 dest=cache/'public/latest-submesh-visibility';dest.mkdir(exist_ok=True);b=json.dumps(meta,indent=2).encode();(dest/'package.json').write_bytes(b)
 proof={'schema':1,'kind':'native-submesh-visibility-observations','packageSha256':sha(b),'preparerSha256':sha(Path(__file__).read_bytes()),'inputs':inputs,
  'sources':{name:sha(Path(__file__).with_name(name).read_bytes())for name in ['submesh_visibility_native.py','vfx_spawn_native.py','vfx_uv_native.py','macho.py']},
  'originalBlocks':list(n.blocks.values()),'sequences':sequences,'counts':{'assets':len(assets),'ranges':sum(len(a['ranges'])for a in assets.values()),
  'groups':sum(len(a['clips'])for a in assets.values()),'events':event_count,'sequences':len(sequences),'frames':sum(len(s['frames'])for s in sequences)},'scope':meta['scope']}
 (cache/'research/submesh-visibility-native.json').write_text(json.dumps(proof,separators=(',',':')),encoding='utf-8');print(json.dumps({'sha256':sha(b),'counts':proof['counts']}))
if __name__=='__main__':main()
