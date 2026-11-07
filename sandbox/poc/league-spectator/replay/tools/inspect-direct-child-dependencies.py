"""Validate a bounded authored child-parent observation without admitting it.

Failed child lookup proves only that observed branch. Successful child spawning
and its scheduler/RNG/lifecycle dependencies remain required evidence.
"""
import argparse
from collections import Counter
import json
from pathlib import Path

from macho import MachImage
from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        value=path.read_bytes();inputs[str(path.resolve())]=sha(value);return value
    def read(path):return json.loads(raw(path))
    native=read(cache/'research/direct-child-parent-native.json')
    if (native['effectId']!='champions/jinx/2/3b1dfaaf' or native['variant']!='authored' or
            not native['completed'] or native['boundary'] is not None or len(native['frames'])!=61 or
            not native['scope']['unchangedCompleteAuthoredRoot'] or native['scope']['forcedResourceLookupSuccess']):
        raise ValueError('Complete bounded authored child observation required')
    for path,digest in native['inputs'].items():
        if sha(raw(Path(path)))!=digest:raise ValueError('Native child input drift')
    tools=Path(__file__).parent
    for name,digest in native['sources'].items():
        if sha(raw(tools/name))!=digest:raise ValueError('Native child producer drift')
    profile=read(cache/'public/decoder-16.21-macos/profile.json')
    image=raw(cache/'public/decoder-16.21-macos/image.bin')
    original=MachImage(raw(args.client)).image
    if sha(image)!=profile['decoderImageSha256']:raise ValueError('Prepared original image differs')
    manifest=read(cache/'public/latest-effects/manifest.json')
    ref=manifest['definitions'][native['effectId']]
    authored=read(cache/'public/latest-effects'/ref['file'])
    if inputs[str((cache/'public/latest-effects'/ref['file']).resolve())]!=ref['sha256']:
        raise ValueError('Authored definition differs')
    emitters=authored['definition']['complexEmitterDefinitionData']
    children=[(i,e['childParticleSetDefinition']) for i,e in enumerate(emitters) if 'childParticleSetDefinition' in e]
    if children!=[(0,{'childrenIdentifiers':[{'effectKey':'{3bad3a24}','__type':'VfxChildIdentifier'}],
                       '__type':'VfxChildParticleSetDefinitionData'})]:raise ValueError('Exact key-only child fixture differs')
    counts=Counter(row['rva'] for row in native['childCalls'])
    expected={0x1754e70:5,0x17556d0:5,0x1755884:5,0x17558b0:5,0x1755c64:5}
    if dict(counts)!=expected:raise ValueError('Expected five original failed child lookups')
    calls=native['childCalls']
    for i in range(5):
        group=calls[i*5:i*5+5]
        if [row['rva'] for row in group]!=list(expected):raise ValueError('Original child branch ordering differs')
        if len({row['rngHex'] for row in group})!=1:raise ValueError('Observed failed child branch changed RNG')
        query=group[2]
        if query['requestedEffectKey']!=0x3bad3a24 or query['resourceContext']!=0:
            raise ValueError('Expected explicit null-context key lookup control')
    first=native['frames'][0];last=native['frames'][-1]
    if [a['vectors']['life']['count'] for a in first['state']['actors']]!=[5,80,1,1,1,25]:
        raise ValueError('Complete six-emitter birth evidence differs')
    if any(a['vectors']['life']['count'] for a in last['state']['actors']):raise ValueError('Retirement boundary not covered')
    if any(f['managerParentCount']!=1 or len(f['state']['actors'])!=6 for f in native['frames']):
        raise ValueError('Observed parent ownership differs')
    blocks=[]
    for start,end in [(0x16e97f4,0x16e9846),(0x1754c30,0x1754d1c),(0x1754e70,0x17556d0),
                      (0x17556d0,0x1755c79),(0x174b760,0x174b8f7),(0x175cb54,0x175cbef)]:
        if image[start:end]!=original[start:end]:raise ValueError('Original child instruction bytes differ')
        blocks.append({'rva':start,'size':end-start,'sha256':sha(image[start:end])})
    raw(Path(__file__));raw(tools/'macho.py');raw(tools/'vfx_spawn_native.py')
    result={'schema':1,'kind':'native-child-resource-dependency-boundary','build':profile['clientVersion'],
        'protocol':profile['protocolDigest'],'effectId':native['effectId'],'frames':61,'childAttempts':5,
        'childLookupKey':0x3bad3a24,'observedResourceContext':0,'originalGlobalFallbackFailures':5,
        'failedLookupRngUnchanged':True,'allSixEmittersBornAndRetired':True,'managerParentCount':1,
        'originalBlocks':blocks,'inputs':inputs,
        'dependency':{'rootIdentityNamedPathBranchUsed':False,
            'required':'accepted child resource context/global lookup, child scheduling and linked-provider lifecycle',
            'successfulBranch':'original 174b760 enqueues child VfxObject; 1755531 return is retained per particle with linked lifecycle callback',
            'successfulSpawnObserved':False,'successfulSpawnSiblingIndependenceProven':False},
        'scope':{'actualMatchContextRecovered':False,'nativeWorldAcceptance':None,'childResourceAcceptance':None,
            'childFreeControlComplete':False,'runtimeAdmissionChanged':False,'parentComponentsRendered':False,
            'productionEligibilityMustRemainBlocked':True}}
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Child dependency input changed during inspection')
    output=cache/'research/direct-child-dependencies.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'frames':61,'childAttempts':5,'successfulSpawnObserved':False,'runtimeAdmissionChanged':False}))


if __name__=='__main__':main()
