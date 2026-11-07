"""Independent prepared-file and SCB geometry checks for native observations."""
import hashlib
import json
import struct
from functools import lru_cache
from xxhash import xxh64_intdigest


def sha(data):return hashlib.sha256(data).hexdigest()


@lru_cache(maxsize=334)
def file_data(path):
    data=path.read_bytes()
    return data,sha(data)


def raw_scb_fields(source):
    # Independent byte-preserving decoding of the retained SCB layout. The JSON
    # export loses negative zero on Python JSON parsing; raw float bytes do not.
    if len(source)<176 or source[:8]!=b'r3d2Mesh':raise ValueError('Invalid independent SCB source')
    version=struct.unpack_from('<HH',source,8)
    if version not in [(2,2),(3,2)]:raise ValueError('Unadmitted independent SCB version')
    vertices,triangles=struct.unpack_from('<II',source,140);at=176
    colors=False
    if version==(3,2):colors=struct.unpack_from('<I',source,at)[0]==1;at+=4
    vertex_data=source[at:at+vertices*12];at+=vertices*12
    if colors:at+=vertices*4
    at+=12
    if len(vertex_data)!=vertices*12 or at+triangles*100>len(source):raise ValueError('Independent SCB geometry exceeds source')
    positions=[];uv=[]
    for triangle in range(triangles):
        face=at+triangle*100
        for corner,index in enumerate(struct.unpack_from('<III',source,face)):
            if index>=vertices or index>65535:raise ValueError('Independent SCB face index exceeds vertices')
            positions.append(vertex_data[index*12:index*12+12])
            uv.extend([source[face+76+corner*4:face+80+corner*4],source[face+88+corner*4:face+92+corner*4]])
    return b''.join(positions),b''.join(uv)


def inspect_case(case,catalog,checks):
    files={path:(root,ref) for path,(root,ref) in catalog.items()
        if ref.get('kind')!='texture' and ref.get('rawFile')}
    mounted={f['path']:f for f in case['staticFileCatalog']}
    if set(mounted)!=set(files):raise ValueError('Native file mount omits or invents a prepared file')
    for path,entry in mounted.items():
        root,ref=files[path];source,digest=file_data(root/ref['rawFile'])
        if (entry['key']!=xxh64_intdigest(path.encode()) or entry['sha256']!=digest or
                entry['sha256']!=ref['sourceSha256'] or entry['bytes']!=len(source)):
            raise ValueError('Native normalized file hash or source bytes differ')
    checks['completeFileMounts']+=1
    handles={h['pointer']:h for h in case['fileOpens']}
    if len(handles)!=len(case['fileOpens']):raise ValueError('Native file handles were reused without ownership evidence')
    for lookup in case['fileLookups']:
        if 'path' in lookup and mounted[lookup['path']]['key']!=lookup['key']:
            raise ValueError('Native filesystem lookup resolves the wrong source path')
        checks['nativeFileLookups']+=1
    for handle in handles.values():
        entry=mounted[handle['path']];header=bytes.fromhex(handle['headerHex'])
        if (handle['sha256']!=entry['sha256'] or handle['bytes']!=entry['bytes'] or
                len(header)!=40 or struct.unpack_from('<QQQ',header,8)!=(handle['data'],handle['bytes'],0) or header[32]):
            raise ValueError('Original memory-file header differs from its owned source')
        checks['originalMemoryFileHeaders']+=1
    for read in case['fileReads']:
        handle=handles[read['pointer']];root,ref=files[read['path']]
        source,_=file_data(root/ref['rawFile']);offset=read['offset'];count=read['bytes']
        if (handle['path']!=read['path'] or not 0<=offset<=offset+count<=len(source) or
                count!=min(read['requested'],len(source)-offset) or sha(source[offset:offset+count])!=read['sha256']):
            raise ValueError('Original memory-file read differs from retained raw file range')
        checks['originalFileReadRanges']+=1;checks['originalFileReadBytes']+=count
    closed=set()
    for close in case['fileCloses']:
        handle=handles[close['pointer']]
        if (close['pointer'] in closed or not handle['closed'] or close['path']!=handle['path'] or
                close['bytes']!=handle['bytes'] or not 0<=close['cursor']<=close['bytes']):
            raise ValueError('Original file close has invalid ownership/cursor')
        closed.add(close['pointer']);checks['closedFileHandles']+=1
    if case['status']=='activated' and (closed!=set(handles) or case['filesystemMutex']['depth']):
        raise ValueError('Successful original activation leaks an open file or filesystem lock')
    buffers={b['nativePointer']:b for b in case['meshBuffers']}
    layouts={v['nativePointer']:v for v in case['meshLayouts']}
    if len(buffers)!=len(case['meshBuffers']) or len(layouts)!=len(case['meshLayouts']):
        raise ValueError('Native mesh resources alias another owned header')
    for buffer in buffers.values():
        data=bytes.fromhex(buffer['bytesHex']);header=bytes.fromhex(buffer['nativeHeaderHex'])
        if (len(data)!=buffer['bytes'] or sha(data)!=buffer['gpuReadbackSha256'] or not buffer['gpuBytesVerified'] or
                len(header)!=72 or struct.unpack_from('<II',header,8)!=(0,len(data)) or
                header[16]!=buffer['flags'] or struct.unpack_from('<I',header,68)[0]!=1):
            raise ValueError('Native vertex buffer header or GPU readback differs')
        checks['gpuMeshBuffers']+=1;checks['gpuMeshBytes']+=len(data)
    for layout in layouts.values():
        count=layout['attributeCount'];source=bytearray.fromhex(layout['descriptorHex'])
        header=bytes.fromhex(layout['nativeHeaderHex'])
        for i in range(count):
            if source[i*8+1]==1:source[i*8+2]=4
        if (bytes(source).hex()!=layout['nativeDescriptorHex'] or header[8:8+count*8]!=source or
                len(header)!=448 or struct.unpack_from('<I',header,396)[0]!=count or
                any(header[136:392]) or layout['shaderAttributeLocationsBound']):
            raise ValueError('Original layout initialization or unbound-shader scope differs')
        semantics=[source[i*8] for i in range(count)]
        for binding in layout['bindings']:
            if (binding['nativeLayout']!=layout['nativePointer'] or binding['nativeBuffer'] not in buffers or
                    semantics.count(binding['semantic'])!=1 or binding['offset']>=binding['stride']):
                raise ValueError('Original layout binding does not belong to its descriptor/buffer')
            checks['originalVertexBindings']+=1
        checks['originalVertexLayouts']+=1
    for mesh in case['staticMeshSetups']:
        buffer=buffers[mesh['nativeBuffer']];layout=layouts[mesh['nativeLayout']]
        root,ref=files[mesh['path']];raw=(root/ref['file']).read_bytes()
        if sha(raw)!=ref['sha256']:raise ValueError('Independent prepared SCB geometry changed')
        geometry=json.loads(raw);data=bytes.fromhex(buffer['bytesHex']);vertices=mesh['triangles']*3
        if len(data)!=vertices*36 or len(geometry['positions'])!=vertices*3 or len(geometry['uv'])!=vertices*2:
            raise ValueError('Original SCB vertex count differs from independently prepared geometry')
        positions=b''.join(data[i*36:i*36+12] for i in range(vertices))
        uv=b''.join(data[i*36+28:i*36+36] for i in range(vertices))
        source,_=file_data(root/ref['rawFile']);raw_positions,raw_uv=raw_scb_fields(source)
        if positions!=raw_positions or uv!=raw_uv:
            raise ValueError('Original SCB position/UV bytes differ from independent raw source decoding')
        for actual,expected in [(positions,geometry['positions']),(uv,geometry['uv'])]:
            packed=struct.pack('<'+'f'*len(expected),*expected)
            for offset in range(0,len(actual),4):
                a,b=actual[offset:offset+4],packed[offset:offset+4]
                if a==b:continue
                if struct.unpack('<f',a)[0]!=0 or struct.unpack('<f',b)[0]!=0:
                    raise ValueError('Original SCB numeric positions/UVs differ from prepared JSON geometry')
                checks['jsonSignedZeroDifferences']+=1
        before=bytes.fromhex(mesh['headerBeforeHex']);after=bytes.fromhex(mesh['headerAfterHex'])
        if (len(before)!=224 or len(after)!=224 or struct.unpack_from('<I',before,160)[0]!=mesh['triangles'] or
                any(after[176:208]) or struct.unpack_from('<QQ',after,208)!=(mesh['nativeBuffer'],mesh['nativeLayout'])):
            raise ValueError('Original SCB setup retained the wrong GPU resource or raw array')
        expected=[(0,0,36),(2,12,36),(3,24,36),(8,28,36)]
        if [(b['semantic'],b['offset'],b['stride']) for b in layout['bindings']]!=expected:
            raise ValueError('Original SCB layout did not bind its four authored vertex fields')
        checks['independentScbPositionsAndUvs']+=1;checks['independentScbVertices']+=vertices
