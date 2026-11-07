"""Read-only projectile resource/gear reachability over raw installed BIN entries."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import cdtb.binfile as binfile


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path)
    parser.add_argument('--character',default='Katarina')
    parser.add_argument('--start',type=float,default=69.)
    parser.add_argument('--end',type=float,default=99.)
    args=parser.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=hashlib.sha256(data).hexdigest()
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Frontier input changed')
        inputs[str(path)]=digest;return data
    def read(path):return json.loads(raw(path))
    report=read(cache/'research/viewer-root-reconstruction.json')['report']
    hero=next(hero for hero in report['heroes'] if hero['champion']==args.character)
    actor=f"champions/{args.character.lower()}/{hero['skinId']}"
    manifest=read(cache/'public/latest-effects/manifest.json')
    package=read(cache/'public/latest-effects/package.json')
    gears=read(cache/'public/latest-unit-gear-resources/package.json')
    if report['build']!=manifest['build'] or report['protocol']!=manifest['protocol'] or gears['build']!=manifest['build']:
        raise ValueError('Exact same-build report/assets/gear table required')
    for dictionary in [value for key,value in vars(binfile).items() if key.startswith('hashfile_')]:dictionary.hashes={}
    for dictionary,name in [(binfile.hashfile_binfields,'binfields'),(binfile.hashfile_bintypes,'bintypes')]:
        dictionary.hashes={int(line.split()[0],16):line.split(maxsplit=1)[1].strip() for line in raw(cache/'vfx'/('hashes.'+name+'.txt')).decode().splitlines()}
    class Reader(binfile.BinReader):
        def __init__(self,*args):super().__init__(*args);self.spans={}
        def read_field(self,kind):
            start=self.f.tell();field=super().read_field(kind);self.spans[id(field)]=(start,self.f.tell());return field
    entries={}
    for source in package['actors'][actor]['sourceBins']:
        stem=f"{source['sourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}"
        path=cache/'research/latest-effects/bins'/f'{stem}.bin'
        data=raw(path);encoded=raw(path.with_suffix('.json'))
        if hashlib.sha256(data).hexdigest()!=source['sourceSha256'] or hashlib.sha256(encoded).hexdigest()!=source['jsonSha256']:
            raise ValueError('Owned installed source bytes/parsed output differ')
        parsed=json.loads(encoded)
        stream=io.BytesIO(data)
        if stream.read(4)!=b'PROP':raise ValueError('Original typed BIN required')
        reader=Reader(stream);_,_,types=reader.read_binfile_header()
        for kind in types:
            entry=reader.read_binfile_entry(kind);key=f'{entry.path.h:08x}'
            value=parsed.get('{'+key+'}')
            if value is None:continue
            counts={name:len(next((field.value.values for field in entry.fields if str(field.name)==name),[]))
                    for name in ['complexEmitterDefinitionData','simpleEmitterDefinitionData']}
            if any(counts[name]!=len(value.get(name,[])) for name in counts):
                raise ValueError('Raw BIN and parsed emitter inventory differ')
            row={'id':key,'typeHash':entry.type.h,'type':str(entry.type),'sourcePath':source['path'],
                 'sourceSha256':source['sourceSha256'],'complexEmitters':counts['complexEmitterDefinitionData'],
                 'simpleEmitters':counts['simpleEmitterDefinitionData'],'particleName':value.get('particleName'),
                 'rawFields':[{'name':str(field.name),'hash':field.name.h,'offset':reader.spans[id(field)][0],
                               'bytes':reader.spans[id(field)][1]-reader.spans[id(field)][0],
                               'sha256':hashlib.sha256(data[slice(*reader.spans[id(field)])]).hexdigest()} for field in entry.fields]}
            if key in entries and entries[key]!=row:raise ValueError('Ambiguous installed definition override')
            entries[key]=row
        if stream.tell()!=len(data):raise ValueError('Raw installed source left unread bytes')
    packet_rows=[]
    refs={}
    for missile in report['missiles']:
        if missile['cast']['ownerId']!=hero['entityId'] or not args.start<=missile['time']<=args.end:continue
        binding=manifest['actors'][actor]['missiles'].get(str(missile['cast']['spellHash']))
        packet_rows.append({'sourceEventId':f"packet:{missile['transportSequence']}:entry:0:missile:{missile['entityId']}",
                           'sequence':missile['sequence'],'time':missile['time'],'ownerId':hero['entityId'],
                           'entityId':missile['entityId'],'spellHash':missile['cast']['spellHash'],
                           'targetCount':missile['cast']['targetCount'],'payloadSha256':missile['payloadSha256'],'binding':binding})
        if not binding or binding.get('status')!='prepared-definition':continue
        resource_key=int(binding['effectKey'].strip('{}'),16)
        definition_id=binding['effectId'].split('/')[-1]
        prepared=manifest['definitions'][binding['effectId']]
        prepared_bytes=raw(cache/'public/latest-effects'/prepared['file'])
        if hashlib.sha256(prepared_bytes).hexdigest()!=prepared['sha256']:raise ValueError('Prepared effect record changed')
        record=json.loads(prepared_bytes)
        source=entries[definition_id]
        if source['complexEmitters']!=prepared['complexEmitters'] or source['simpleEmitters']!=prepared['simpleEmitters']:
            raise ValueError('Manifest emitter counts differ from raw installed entry')
        overrides=[]
        for gear in gears['actors'][actor]:
            matches=[(index,row) for index,row in enumerate(gear['rows']) if row['key']==resource_key]
            if not matches:continue
            index,row=matches[0] # Original package declares first-native-row-with-key.
            target=entries.get(f"{row['value']:08x}")
            overrides.append({'index':gear['index'],'gearIdentity':gear['gearIdentity'],'nativeRowIndex':index,
                              'referenceToken':row['value'],'target':target,
                              'currentlyPrepared':f"{actor}/{row['value']:08x}" in manifest['definitions'],
                              'liveSelectionEstablished':False})
        refs[resource_key]={'resourceKey':resource_key,'baseEffectId':binding['effectId'],'preparedDefinitionSha256':prepared['sha256'],
                            'rawInstalledBase':source,'preparedSourceBins':record['sourceBins'],'gearOverrides':overrides}
    requests=[row for row in report['resourceRequests'] if row['entityId']==hero['entityId']]
    prefix_path=cache/f'research/positive-form-resource-{actor.replace("/","-")}-native.json'
    prefix=read(prefix_path)
    if prefix['actorKey']!=actor or not prefix['scope']['actualInstalledGearTableLoadedAndLinked'] or not prefix['scope']['resourcePrefixThroughSelectedPushExecuted']:
        raise ValueError('Exact installed positive gear resource prefix evidence required')
    for group in ['inputs','sources']:
        for path,digest in prefix[group].items():
            if hashlib.sha256(raw(path)).hexdigest()!=digest:raise ValueError('Stale positive resource prefix evidence')
    prefix_evidence={'artifact':str(prefix_path),'sha256':inputs[str(prefix_path)],'currentInputs':len(prefix['inputs']),
                     'currentSources':len(prefix['sources']),'positivePrefixControls':prefix['controls'],
                     'completePositiveListener':prefix['scope']['completeOpcode129Executed'],
                     'fullListenerBoundary':prefix['fullListenerBoundary'],'scope':prefix['scope']}
    for name in ['latest-unit-gear-resources.mjs','latest-initial-resource-prefix.mjs','latest-resource-requests.mjs']:
        raw(Path(__file__).resolve().parents[1]/name)
    raw(__file__)
    for path,digest in inputs.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=digest:raise ValueError('Frontier input drift')
    output=cache/f'research/{args.character.lower()}-projectile-gear-frontier-v35.json'
    result={'schema':1,'kind':'raw-installed-projectile-gear-resource-frontier','artifactVersion':35,'status':'PASS',
            'build':report['build'],'protocol':report['protocol'],'inputs':inputs,'owner':hero,'actor':actor,
            'window':[args.start,args.end],'packets':packet_rows,'resources':list(refs.values()),'recordedResourceRequests':requests,
            'originalPositiveResourcePrefix':prefix_evidence,
            'counts':{'actualMissiles':len(packet_rows),'preparedMissileReferences':sum(row['binding'] is not None and row['binding'].get('status')=='prepared-definition' for row in packet_rows),
                      'distinctPreparedResourceKeys':len(refs)},
            'missingLiveState':['accepted-initial-and-positive-gear-selection','actual-linked-gear-resolver-and-resource-precedence-at-each-cursor'],
            'scope':{'rawInstalledEmitterFieldsCompared':True,'baseZeroEmittersAreAuthored':True,
                     'authoredGearIsNotActualEquippedState':True,'selectedGearRecovered':False,'resourceGraphPublished':False,
                     'eligibilityChanged':False,'renderedCoverageCounted':False}}
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts'],'resources':[{'key':row['resourceKey'],
                      'base':row['baseEffectId'],'baseComplex':row['rawInstalledBase']['complexEmitters'],
                      'gearComplex':[(gear['index'],gear['target']['complexEmitters'] if gear['target'] else None) for gear in row['gearOverrides']]} for row in refs.values()]}))


if __name__=='__main__':main()
