"""Compare native CPU triangle visits and GPU indices with installed SKN bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import xxhash
import zstandard


def sha(data):return hashlib.sha256(data).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('cache',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();tools=Path(__file__).resolve().parent;inputs={}
    def raw(path):
        path=Path(path);data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    report=json.loads(raw(cache/'research/character-mesh-cpu-index-native.json'))
    if (report['boundary'] or not report['scope']['originalCpuMeshConstructed'] or
            not report['scope']['skeletonRemappingExecuted'] or not report['scope']['gpuIndexBytesVerified']):
        raise ValueError('Completed CPU mesh and verified native index-buffer control required')
    for name,expected in report['sources'].items():
        if sha(raw(tools/name))!=expected:raise ValueError('Mesh producer changed: '+name)
    for name,expected in report['inputs'].items():
        if sha(raw(name))!=expected:raise ValueError('Mesh input changed: '+name)
    key=xxhash.xxh64_intdigest(report['meshPath'].lower());matches=[]
    for archive in report['setup']['archives']:
        data=raw(archive['path'])
        if sha(data)!=archive['fileSha256'] or data[:4]!=b'RW\x03\x04':raise ValueError('Installed mesh archive changed')
        count=struct.unpack_from('<I',data,268)[0]
        if not 0<count<=262144 or 272+count*32>len(data):raise ValueError('Independent WAD table exceeds bounds')
        for i in range(count):
            row=272+i*32
            if struct.unpack_from('<Q',data,row)[0]!=key:continue
            _,offset,packed,size=struct.unpack_from('<QIII',data,row)
            if data[row+20]&15!=3 or not 0<size<=1048576 or offset>len(data)-packed:
                raise ValueError('Independent mesh payload compression/bounds differ')
            payload=zstandard.ZstdDecompressor().decompress(data[offset:offset+packed],max_output_size=size)
            if len(payload)!=size:raise ValueError('Independent SKN decoded size differs')
            matches.append(payload)
    if len(matches)!=1:raise ValueError('Exactly one mounted installed SKN payload required')
    data=matches[0]
    if len(data)<12 or struct.unpack_from('<IHH',data)!=(0x112233,4,1):
        raise ValueError('Independent comparison admits SimpleSkin 4.1 only')
    count=struct.unpack_from('<I',data,8)[0];at=12;materials=[]
    if not 0<count<=255 or at+count*80+60>len(data):raise ValueError('Independent material table exceeds bounds')
    for _ in range(count):
        name=data[at:at+64].split(b'\0',1)[0].decode('utf-8')
        start_vertex,vertices,start_index,indices=struct.unpack_from('<IIII',data,at+64)
        materials.append({'name':name,'startVertex':start_vertex,'vertices':vertices,
                          'startIndex':start_index,'indices':indices});at+=80
    flags,indices,vertices,stride,kind=struct.unpack_from('<IIIII',data,at);at+=60
    if flags!=0 or (stride,kind) not in [(52,0),(56,1),(72,2)] or not 0<indices<=3000000 or indices%3:
        raise ValueError('Independent SKN flags/vertex declaration/index count differ')
    end=at+indices*2+vertices*stride
    if end+12!=len(data) or any(data[end:]):raise ValueError('Independent SKN buffer/trailer bounds differ')
    if any(m['startVertex']+m['vertices']>vertices or m['startIndex']+m['indices']>indices or m['indices']%3 for m in materials):
        raise ValueError('Independent SKN material range exceeds its buffers')
    if sorted((m['startIndex'],m['startIndex']+m['indices']) for m in materials)!=[
            (sum(m['indices'] for m in materials[:i]),sum(m['indices'] for m in materials[:i+1])) for i in range(count)]:
        raise ValueError('Independent SKN material ranges do not partition the indices in order')
    source=data[at:at+indices*2]
    # Original reader 18545e0 subtracts each material's start vertex. Compare
    # that representation independently; raw global SKN indices are different.
    local=bytearray(source)
    for material in materials:
        for i in range(material['startIndex'],material['startIndex']+material['indices']):
            index=struct.unpack_from('<H',source,i*2)[0]
            if not material['startVertex']<=index<material['startVertex']+material['vertices']:
                raise ValueError('Independent SKN index is outside its material vertex range')
            struct.pack_into('<H',local,i*2,index-material['startVertex'])
    gpu=report['indexBuffer'];actual=bytes.fromhex(gpu['bytesHex'])
    if (gpu['nativeIndexFormat']!=0 or gpu['indexBytes']!=2 or not gpu['gpuBytesVerified'] or
            gpu['bytes']!=len(source) or actual!=local or gpu['gpuReadbackSha256']!=sha(local)):
        raise ValueError('Native GPU index bytes differ from independent material-local SKN indices')
    progress=report['meshProgress']
    if (len(progress)!=1 or not progress[0]['completed'] or progress[0]['sourceIndices']!=indices or
            progress[0]['materials']!=count or progress[0]['triangleBound']!=indices//3 or
            progress[0]['trianglesVisited']!=indices//3):
        raise ValueError('Original CPU triangle progress differs from independent SKN ranges')
    vertex_bytes=0
    if report.get('gpuMesh'):
        buffer=report['gpuMesh']['buffer'];vertex_source=data[at+indices*2:end]
        actual_vertices=bytes.fromhex(buffer['bytesHex'])
        if (not buffer['gpuBytesVerified'] or buffer['bytes']!=vertices*stride or
                actual_vertices!=vertex_source or buffer['gpuReadbackSha256']!=sha(vertex_source)):
            raise ValueError('Original GPU vertex bytes differ from independently extracted SKN vertices')
        vertex_bytes=len(vertex_source)
    for module in [zstandard.backend_c,xxhash._xxhash]:raw(module.__file__)
    output=cache/'research/character-mesh-indices-comparison.json'
    result={'schema':1,'kind':'native-character-mesh-index-comparison','build':report['build'],
            'inputs':inputs,'sourceSha256':sha(Path(__file__).read_bytes()),'meshPath':report['meshPath'],
            'decodedSknSha256':sha(data),'materials':materials,
            'counts':{'materials':count,'vertices':vertices,'indices':indices,'triangles':indices//3,
                      'gpuIndexBytes':len(source),'gpuVertexBytes':vertex_bytes},
            'materialLocalIndicesMatchGpuReadback':True,'cpuTriangleVisitsMatchSource':True,
            'rawGlobalIndexSha256':sha(source),'materialLocalIndexSha256':sha(local),
            'originalReaderRebaseLoopRva':0x18545e0,
            'vertexSourceBytesMatchGpuReadback':vertex_bytes>0,
            'scope':{'topologyAndBufferBytesOnly':True,'animatedPoseVerified':False,
                     'meshDrawVerified':False,'completeAppearanceVerified':False,'mainViewerExpanded':False}}
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts']}))


if __name__=='__main__':main()
