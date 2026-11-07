"""Compare CPU shared-layout names and bone capacity with installed definitions."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import xxhash
import zstandard


def sha(data):return hashlib.sha256(data).hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);args=p.parse_args()
    cache=args.cache.resolve();root=Path(__file__).resolve().parents[1];inputs={}
    def raw(path):
        data=Path(path).read_bytes();inputs[str(Path(path).resolve())]=sha(data);return data
    def read(path):return json.loads(raw(path))
    native=read(cache/'research/shared-constant-inputs-native.json')
    if native['boundary'] or not native['constants'] or native['nativeFieldSkips'] or native['nativeTypeMismatches']:
        raise ValueError('Complete CPU-layout prefixes without native skips/mismatches required')
    for file,expected in native['sources'].items():
        if sha(raw(root/'tools'/file))!=expected:raise ValueError('Shared constant producer changed: '+file)
    for file,expected in native['inputs'].items():
        if sha(raw(file))!=expected:raise ValueError('Shared constant input changed: '+file)
    index=read(cache/'research/global-asset-inputs/index.json')
    if index['build']!=native['build']:raise ValueError('Matching prepared global definitions required')
    for file,expected in index['sources'].items():
        if sha(raw(root/file))!=expected:raise ValueError('Global-definition producer changed: '+file)
    sources=[s for s in index['jobs'] if s['path']=='assets/shaders/shareddata.bin']
    if len(sources)!=1:raise ValueError('One prepared shared-data definition file required')
    source=sources[0];encoded=raw(source['source']);decoded=raw(source['output'])
    if sha(encoded)!=source['sha256'] or sha(decoded)!=source['jsonSha256']:raise ValueError('Prepared shared definitions changed')
    archives=[a for a in native['setup']['archives'] if Path(a['path']).name=='Bootstrap.windows.wad.client']
    if len(archives)!=1:raise ValueError('Validated installed Bootstrap archive required')
    archive=raw(archives[0]['path'])
    if sha(archive)!=archives[0]['fileSha256'] or archive[:4]!=b'RW\x03\x04':raise ValueError('Installed Bootstrap archive changed')
    count=struct.unpack_from('<I',archive,268)[0];table=archive[272:272+count*32]
    key=xxhash.xxh64_intdigest(source['path'])
    entries=[table[i:i+32] for i in range(0,len(table),32) if struct.unpack_from('<Q',table,i)[0]==key]
    if len(entries)!=1:raise ValueError('Installed shared definitions missing/duplicated')
    entry=entries[0];_,offset,packed,size=struct.unpack_from('<QIII',entry)
    if entry[20]&15!=3 or not 0<size<=1048576 or offset>len(archive)-packed:raise ValueError('Shared definition payload bounds/compression differ')
    actual=zstandard.ZstdDecompressor().decompress(archive[offset:offset+packed],max_output_size=size)
    if actual!=encoded:raise ValueError('Prepared definitions differ from installed WAD payload')
    data=json.loads(decoded);reference=data['{85390927}']
    names=[data[identity]['name'] for identity in reference['constantBuffers']]
    layouts=native['bufferLayouts']
    if [r['name'] for r in layouts]!=names or any(not r['completed'] or r['originalPlatformInput']!=4 for r in layouts):
        raise ValueError('Native CPU layouts differ from authored constant-buffer order/names')
    authored=[(buffer,row) for buffer in names for definition in [next(d for d in data.values() if isinstance(d,dict) and d.get('__type')=='X3DSharedConstantBufferDef' and d.get('name')==buffer)]
              for row in definition['constants'] if row['name']=='BONES' and row.get('PlatformMask',0)&(1<<4)]
    if len(authored)!=1 or authored[0][1]['type']!=8:raise ValueError('Unique authored platform-4 matrix3x4 bone declaration required')
    buffer,row=authored[0];matrices=row['Count'];vectors=matrices*3;bytes_=vectors*16
    bones=native['constants']['bones'];bone_layouts=[r for r in layouts if r['name']==buffer]
    if (len(bone_layouts)!=1 or bones['matrices']!=matrices or bones['vectors']!=vectors or
            bone_layouts[0]['bytes']!=bytes_):raise ValueError('Original bone capacity/layout differs from authored platform declaration')
    for module in [zstandard.backend_c,xxhash._xxhash]:raw(module.__file__)
    output=cache/'research/shared-constant-inputs-comparison.json'
    result={'schema':1,'kind':'native-shared-constant-definition-comparison','build':native['build'],'inputs':inputs,
            'sourceSha256':sha(Path(__file__).read_bytes()),
            'counts':{'constantBufferLayouts':len(layouts),'boneMatrices':matrices,'boneVectors':vectors,'boneBytes':bytes_},
            'installedPayloadMatched':True,'bufferNamesAndOrderMatched':True,'boneDeclarationMatched':True,
            'scope':{'cpuLayoutMetadataOnly':True,'allMemberOffsetsCompared':False,'backendBufferPublicationVerified':False,
                     'gpuUniformValuesCompared':False,'mainViewerExpanded':False}}
    output.write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'output':str(output),'counts':result['counts']}))


if __name__=='__main__':main()
