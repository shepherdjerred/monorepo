"""Compile exact-build attached-mesh selection rules from complete loaded assets."""
import argparse,json,random,struct
from pathlib import Path
from attached_mesh_native import NativeAttachedMesh,BLOCKS
from submesh_visibility_native import BLOCKS as RESOURCE_BLOCKS
from vfx_spawn_native import sha,name_hash,ADDRESSES as A

def main():
 p=argparse.ArgumentParser(description=__doc__)
 for name in ['cache','client']:p.add_argument(name,type=Path)
 a=p.parse_args();cache=a.cache.resolve();inputs={}
 def raw(path):
  b=path.read_bytes();inputs[str(path.resolve())]=sha(b);return b
 def read(path):return json.loads(raw(path))
 decoder=cache/'public/decoder-16.21-macos';post=read(decoder/'vfx-postload.json');submesh=read(cache/'public/latest-submesh-visibility/package.json');effects=read(cache/'public/latest-effects/manifest.json')
 n=NativeAttachedMesh(decoder,a.client)
 if inputs[str((decoder/'vfx-postload.json').resolve())]!=n.profile['vfxPostloadSha256']or inputs[str((cache/'public/latest-effects/manifest.json').resolve())]!=post['effectsManifestSha256']:raise ValueError('Attached mesh source package differs')
 assets={v['actor']:v for v in submesh['assets'].values()};rng=random.Random(0x16218298);entries={};observations=[];counts={'emitters':0,'cacheChecks':0,'drawMaskChecks':0,'secondPassChecks':0,'channelChecks':0,'assetPreservationChecks':0};definitions={}
 def hash_value(name):
  if name.startswith('{')and name.endswith('}')and len(name)==10:return int(name[1:-1],16)
  return name_hash(name)
 for key,ref in post['emitters'].items():
  if ref['effectId']not in definitions:
   d=effects['definitions'][ref['effectId']];b=raw(cache/'public/latest-effects'/d['file'])
   if sha(b)!=d['sha256']:raise ValueError('Attached emitter definition changed')
   definitions[ref['effectId']]=json.loads(b)
  doc=definitions[ref['effectId']];emitter=doc['definition']['complexEmitterDefinitionData'][ref['emitterIndex']]
  if emitter.get('primitive',{}).get('__type')!='VfxPrimitiveAttachedMesh':continue
  b=raw(decoder/ref['file'])
  if sha(b)!=ref['sha256']:raise ValueError('Attached native post-load graph changed')
  state=json.loads(b);asset=assets[doc['actor']];names=[r['name']for r in asset['ranges']];spec=n.load_attached(names,state)
  authored=emitter['primitive'];mesh=authored.get('mMesh',{})
  if spec!={'drawHashes':[hash_value(v)for v in mesh.get('mSubmeshesToDraw',[])],
   'alwaysHashes':[hash_value(v)for v in mesh.get('mSubmeshesToDrawAlways',[])],
   'useAvatarMask':authored.get('UseAvatarSpecificSubmeshMask',False),'lockMeshToAttachment':mesh.get('mLockMeshToAttachment',False)}:raise ValueError('Native attached field meaning differs')
  channels=[]
  for value in [False,True]:
   channel=n.mask_channel(value)
   if channel!=int(value):raise ValueError('Native attached mask-channel route differs')
   channels.append({'value':value,'channel':channel});counts['channelChecks']+=1
  n.put(n.primitive+0x8b,'B',spec['useAvatarMask'])
  frames=[]
  for index,resource in enumerate([0,1,1,2,2,0,0,1]):
   cached=n.cache(resource);counts['cacheChecks']+=1
   samples=[]
   masks=[0,1,0xffffffff,0xffff8020,rng.getrandbits(32)]
   if index==1:masks.extend(1<<bit for bit in range(32))
   for owner_mask in masks:
    value=n.combine(owner_mask);other=n.combine_second_pass(owner_mask)
    if value!=other:raise ValueError('Native attached draw passes disagree')
    samples.append({'ownerMask':owner_mask,'drawMask':value,'secondPassMask':other});counts['drawMaskChecks']+=1;counts['secondPassChecks']+=1
   frames.append({'input':resource,'output':cached,'draws':samples})
  if bytes(n.u.mem_read(A['definition'],0x470)).hex()!=state['objectHex']or bytes(n.u.mem_read(state['heapStart'],len(state['heapHex'])//2)).hex()!=state['heapHex']:raise ValueError('Attached selection altered authored asset bytes')
  counts['assetPreservationChecks']+=1;counts['emitters']+=1
  entries[key]={'effectId':ref['effectId'],'emitterIndex':ref['emitterIndex'],'actor':doc['actor'],'emitterName':emitter.get('emitterName'),
   'sourceDefinitionSha256':ref['definitionSha256'],'postloadGraphSha256':ref['sha256'],'postloadGraphFile':ref['file'],**spec}
  observations.append({'key':key,'names':names,'alternateNames':list(reversed(names)),'channels':channels,'frames':frames})
 scope={'completePostloadedAssetRead':True,'nativeResourceMapConstructorExecuted':True,'nativeMaskCachePrefixExecuted':True,'nativeDrawMaskFragmentsExecuted':True,
  'nativeMaskChannelBranchExecuted':True,'originalOwnerLookupExecuted':False,'originalParticleSimulationExecuted':False,'meshPoseBindingExecuted':False,'shaderMaterialBindingExecuted':False,
  'graphicsSubmissionExecuted':False,'mainViewerIntegrated':False,'leagueAvCompared':False}
 source_ranges=BLOCKS+RESOURCE_BLOCKS
 meta={'schema':1,'kind':'native-attached-mesh-selection','build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'decoderImageSha256':n.profile['decoderImageSha256'],'sliceSha256':n.profile['sliceSha256'],
  'submeshVisibilityPackageSha256':inputs[str((cache/'public/latest-submesh-visibility/package.json').resolve())],'postloadPackageSha256':n.profile['vfxPostloadSha256'],
  'effectsManifestSha256':inputs[str((cache/'public/latest-effects/manifest.json').resolve())],
  'defaults':{'selectedMask':0xffffffff,'alwaysMask':0,'resource':0},'entries':entries,
  'sourceBlocks':[{'startRva':x,'endRva':y,'sha256':sha(n.image[x:y])}for x,y in source_ranges],'scope':scope}
 dest=cache/'public/latest-attached-mesh';dest.mkdir(exist_ok=True);b=json.dumps(meta,indent=2).encode();(dest/'package.json').write_bytes(b)
 proof={'schema':1,'kind':'native-attached-mesh-selection-observations','packageSha256':sha(b),'preparerSha256':sha(Path(__file__).read_bytes()),'inputs':inputs,
  'sources':{name:sha(Path(__file__).with_name(name).read_bytes())for name in ['attached_mesh_native.py','submesh_visibility_native.py','vfx_spawn_native.py','vfx_uv_native.py','macho.py']},
  'originalBlocks':list(n.blocks.values()),'observations':observations,'counts':counts,'scope':scope}
 (cache/'research/attached-mesh-native.json').write_text(json.dumps(proof,separators=(',',':')),encoding='utf-8');print(json.dumps({'sha256':sha(b),'counts':counts}))
if __name__=='__main__':main()
