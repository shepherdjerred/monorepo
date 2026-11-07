"""Complete installed map VFX roots through the shared original asset reader.

All declared roots are attempted in bounded batches. Failed roots remain explicit
boundaries; successful graphs retain every serialized field and emitter. No
replay, active map variant, guest choice or runtime activation is supplied here.
"""
import argparse
from collections import Counter
import importlib.metadata
import inspect
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys
from vfx_system_asset_native import SYSTEM_TYPE
from map_vfx_asset_native import NativeMapVfxSystemAssets
from vfx_spawn_native import sha

BATCH_SIZE = 32


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('--batch-index',type=int)
    args = p.parse_args()
    cache = args.cache.resolve()
    assets = cache/'public'
    work = cache/'research/map-vfx-system-batches'
    output = assets/'latest-map-vfx-systems'
    work.mkdir(exist_ok=True)
    (output/'graphs').mkdir(parents=True,exist_ok=True)
    inputs = {}
    def raw(path):
        b = path.read_bytes()
        inputs[str(path.resolve())] = sha(b)
        return b
    def read(path):
        return json.loads(raw(path))
    source_package_path = assets/'latest-map-effect-inputs/package.json'
    source_package = read(source_package_path)
    definitions = read(assets/'latest-map-effect-inputs'/source_package['definitions']['file'])
    profile = read(assets/'decoder-16.21-macos/profile.json')
    asset_meta = read(assets/'decoder-16.21-macos/vfx-assets.json')
    if (source_package['build'] != profile['clientVersion'] or source_package['protocol'] != profile['protocolDigest'] or
            source_package['decoderImageSha256'] != profile['decoderImageSha256'] or
            inputs[str((assets/'latest-map-effect-inputs'/source_package['definitions']['file']).resolve())] != source_package['definitions']['sha256'] or
            inputs[str((assets/'decoder-16.21-macos/vfx-assets.json').resolve())] != profile['vfxAssetsSha256'] or
            len(definitions) != source_package['definitions']['count']):
        raise ValueError('Exact-build map/native asset sources differ')
    for name,digest in source_package['sources'].items():
        if sha(raw(Path(__file__).parent.parent/name)) != digest:
            raise ValueError('Map input producer changed: '+name)
    keys = sorted(definitions)
    batch_count = (len(keys)+BATCH_SIZE-1)//BATCH_SIZE
    paths = {Path(__file__),Path(__file__).with_name('parse-latest-assets.py'),Path(__file__).with_name('macho.py')}
    paths.update(Path(inspect.getfile(c)) for c in NativeMapVfxSystemAssets.__mro__ if c is not object)
    sources = {path.name:sha(path.read_bytes()) for path in sorted(paths)}
    if args.batch_index is None:
        for index in range(batch_count):
            subprocess.run([sys.executable,str(Path(__file__).resolve()),str(cache),str(args.client.resolve()),
                '--batch-index',str(index)],check=True)
        systems,failures,blocks,postload_blocks,batches = {},[],{},{},[]
        memory_service = None
        counts = Counter()
        for index in range(batch_count):
            path = work/f'batch-{index:03d}.json'
            batch = read(path)
            if batch['sources'] != sources or batch['keys'] != keys[index*BATCH_SIZE:(index+1)*BATCH_SIZE]:
                raise ValueError('Stale or incomplete map system batch')
            if memory_service is not None and memory_service != batch['memoryService']:
                raise ValueError('Map compiler memory ABI changed across batches')
            memory_service = batch['memoryService']
            for name,digest in batch['inputs'].items():
                if sha(Path(name).read_bytes()) != digest:
                    raise ValueError('Map system batch input changed')
                inputs[name] = digest
            for key,value in batch['systems'].items():
                if key in systems:
                    raise ValueError('Duplicate compiled map root')
                systems[key] = value
            failures.extend(batch['failures'])
            counts.update(batch['counts'])
            for table,values in [(blocks,batch['originalBlocks']),(postload_blocks,batch['postloadBlocks'])]:
                for value in values:
                    table_key = f"{value['rva']}:{value['size']}"
                    if table_key in table and table[table_key] != value:
                        raise ValueError('Original map compiler instructions changed')
                    table[table_key] = value
            batches.append({'file':str(path),'sha256':sha(path.read_bytes())})
        if ({key.rsplit('/',1)[1] for key in systems}|{f['id'] for f in failures}) != set(keys):
            raise ValueError('Map root preparation omitted a declared asset')
        package = {'schema':1,'kind':'native-complete-map-vfx-systems','build':profile['clientVersion'],
            'protocol':profile['protocolDigest'],'decoderImageSha256':profile['decoderImageSha256'],
            'mapInputsSha256':inputs[str(source_package_path.resolve())],
            'nativeAssetInventorySha256':profile['vfxAssetsSha256'],'rootType':SYSTEM_TYPE,'rootBytes':0x160,
            'rootConstructorRva':0x1786e80,'fieldReaderRva':0x14bc830,'postloadRva':0x14bc490,
            'systems':systems,'unprepared':failures,'counts':dict(counts),'compilerSources':sources,
            'modeledMemoryService':memory_service,
            'scope':{'staticBuildDataOnly':True,'containsReplayEvents':False,'completeSerializedRoots':True,
                'allDeclaredRootsAttempted':True,'originalPostloadCallbacks':True,'parentOverridesPreserved':True,
                'resourceAcquisitionExecuted':False,'runtimeFactoryExecuted':False,'activeMapVariantRecovered':False,
                'activeGuestRecovered':False,'browserExecuted':False,'referenceCompared':False}}
        encoded = json.dumps(package,separators=(',',':'),allow_nan=False).encode()
        (output/'package.json').write_bytes(encoded)
        observation = {'schema':1,'kind':'native-map-vfx-system-observations','build':profile['clientVersion'],
            'packageSha256':sha(encoded),'inputs':inputs,'sources':sources,'batches':batches,
            'counts':dict(counts),'failures':failures,'originalBlocks':list(blocks.values()),
            'postloadBlocks':list(postload_blocks.values()),'scope':package['scope']}
        (cache/'research/map-vfx-systems-native.json').write_text(json.dumps(observation,indent=2),encoding='utf-8')
        print(json.dumps({'packageSha256':sha(encoded),'counts':dict(counts),'boundaries':len(failures)}),flush=True)
        return
    index = args.batch_index
    if not 0 <= index < batch_count:
        raise ValueError('Invalid map asset batch')
    if json.loads(importlib.metadata.distribution('cdtb').read_text('direct_url.json'))['vcs_info']['commit_id'] != source_package['parser']['cdtbRevision']:
        raise ValueError('Typed map BIN parser revision differs')
    import cdtb.binfile as binfile
    names = runpy.run_path(str(Path(__file__).with_name('parse-latest-assets.py')))['names']
    for dictionary,name in [(binfile.hashfile_binfields,'binfields'),(binfile.hashfile_bintypes,'bintypes')]:
        path = cache/'vfx'/f'hashes.{name}.txt'
        if sha(raw(path)) != source_package['parser']['dictionaries'][name]['sha256']:
            raise ValueError('Typed map compiler name dictionary differs')
        dictionary.hashes = names(path)
    for dictionary in [binfile.hashfile_binentries,binfile.hashfile_binhashes,binfile.hashfile_binhashes_xxh3,binfile.hashfile_binpaths]:
        dictionary.hashes = {}
    class Reader(binfile.BinReader):
        def __init__(self,*args):
            super().__init__(*args)
            self.spans = {}
        def read_field(self,htype):
            start = self.f.tell()
            field = super().read_field(htype)
            self.spans[id(field)] = (start,self.f.tell())
            return field
    data = raw(assets/'latest-map-effect-inputs'/source_package['source']['file'])
    if sha(data) != source_package['source']['sha256']:
        raise ValueError('Complete original map BIN changed')
    stream = io.BytesIO(data)
    if stream.read(4) != b'PROP':
        raise ValueError('Unpatched map PROP source required')
    reader = Reader(stream)
    _,_,types = reader.read_binfile_header()
    entries = {e.path.h:e for e in [reader.read_binfile_entry(t) for t in types]}
    if stream.tell() != len(data):
        raise ValueError('Map BIN parser left unread bytes')
    n = NativeMapVfxSystemAssets(assets/'decoder-16.21-macos',args.client)
    systems,failures,counts = {},[],Counter()
    for key in keys[index*BATCH_SIZE:(index+1)*BATCH_SIZE]:
        entry = entries[int(key,16)]
        if entry.type.h != SYSTEM_TYPE or json.loads(json.dumps(entry.to_serializable(),allow_nan=False)) != definitions[key]:
            raise ValueError('Original map root differs from the complete declaration')
        fields = [data[a:b] for a,b in [reader.spans[id(f)] for f in entry.fields]]
        effect_id = f'map/12/{key}'
        try:
            reserve_start = len(n.map_buffer_reserves)
            before = n.load_system(fields)
            if before['ignored'] or before['mismatched']:
                raise ValueError('Original map field reader skipped/mismatched a serialized field')
            after = n.postload_system()
            graph = {'schema':1,'build':profile['clientVersion'],'protocol':profile['protocolDigest'],
                'rootType':SYSTEM_TYPE,'rootBytes':0x160,'effectId':effect_id,
                'phase':'complete-system-native-postload',**after,'ignored':[],'mismatched':[]}
            encoded = json.dumps(graph,separators=(',',':'),allow_nan=False).encode()
            digest = sha(encoded)
            (output/'graphs'/f'{digest}.json').write_bytes(encoded)
            systems[effect_id] = {'file':f'graphs/{digest}.json','sha256':digest,'bytes':len(encoded),
                'definitionSha256':source_package['definitionIndex'][key]['sha256'],
                'rawSourceSha256':source_package['source']['sha256'],
                'rootSha256':sha(bytes.fromhex(after['objectHex'])),'heapSha256':sha(bytes.fromhex(after['heapHex'])),
                'heapBytes':len(after['heapHex'])//2,'visits':len(after['visits']),
                'pendingLinkFixups':after['pendingLinkFixups'],
                'fields':[{'hash':f.name.h,'type':int(f.type),'offset':reader.spans[id(f)][0],
                    'bytes':len(blob),'sha256':sha(blob)} for f,blob in zip(entry.fields,fields)]}
            counts['preparedRoots'] += 1
            counts['modeledByteBufferReserves'] += len(n.map_buffer_reserves)-reserve_start
            counts['serializedFields'] += len(fields)
            counts['objectVisits'] += len(after['visits'])
            counts['callbackVisits'] += sum(v['callbackRva'] is not None for v in after['visits'])
            counts['pendingLinkFixups'] += after['pendingLinkFixups']
            counts['directComplexEmitters'] += int.from_bytes(bytes.fromhex(after['objectHex'])[0x28:0x2c],'little')
            counts['directSimpleEmitters'] += int.from_bytes(bytes.fromhex(after['objectHex'])[0x38:0x3c],'little')
        except Exception as error:
            from unicorn import x86_const as r
            failures.append({'id':key,'effectId':effect_id,'status':'native-asset-preparation-boundary',
                'errorType':type(error).__name__,'error':str(error),'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base})
            counts['boundaryRoots'] += 1
        finally:
            if n.arena_before is not None:
                n.restore_preload_arena()
        counts['attemptedRoots'] += 1
    batch = {'schema':1,'keys':keys[index*BATCH_SIZE:(index+1)*BATCH_SIZE],'inputs':inputs,'sources':sources,
        'memoryService':n.map_memory_service,'memoryServiceCalls':n.map_buffer_reserves,
        'systems':systems,'failures':failures,'counts':dict(counts),
        'originalBlocks':list(n.blocks.values()),'postloadBlocks':list(n.postload_blocks.values())}
    (work/f'batch-{index:03d}.json').write_text(json.dumps(batch,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'batch':index+1,'batches':batch_count,**dict(counts)}),flush=True)


if __name__ == '__main__':
    main()
