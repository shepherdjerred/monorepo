"""Compare native catalog names with independent installed BIN/info reads."""
import argparse
import hashlib
import importlib.metadata
import io
import json
from pathlib import Path
import struct
import xxhash
import zstandard


def sha(data):return hashlib.sha256(data).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);args=parser.parse_args()
    cache=args.cache.resolve();root=Path(__file__).resolve().parent
    path=cache/'research/champion-catalog-native.json';raw=path.read_bytes();native=json.loads(raw)
    if native['boundary'] or not native['scope']['originalCatalogConstructorCompleted']:
        raise ValueError('A completed original catalog control is required')
    for file,digest in native['sources'].items():
        if sha((root/file).read_bytes())!=digest:raise ValueError('Catalog producer changed: '+file)
    for file,digest in native['inputs'].items():
        if sha(Path(file).read_bytes())!=digest:raise ValueError('Catalog input changed: '+file)
    archive=Path(native['installedArchive']['path']).read_bytes()
    if sha(archive)!=native['installedArchive']['fileSha256'] or archive[:4]!=b'RW\x03\x04':
        raise ValueError('Matching validated WAD 3.4 archive required')
    count=struct.unpack_from('<I',archive,268)[0];index=archive[272:272+count*32]
    if sha(index)!=native['installedArchive']['indexSha256']:raise ValueError('Catalog archive index changed')
    decoded={};records=[]
    for file in ['global/champions/champions.bin','global/champions/championskins.info']:
        key=xxhash.xxh64_intdigest(file)
        entries=[index[i:i+32] for i in range(0,len(index),32) if struct.unpack_from('<Q',index,i)[0]==key]
        if len(entries)!=1:raise ValueError('Catalog reference path is missing or duplicated: '+file)
        entry=entries[0];_,offset,packed,size=struct.unpack_from('<QIII',entry)
        if entry[20]&15!=3 or not 0<size<=1048576 or offset>len(archive)-packed:
            raise ValueError('Unadmitted catalog reference compression/bounds')
        payload=zstandard.ZstdDecompressor().decompress(archive[offset:offset+packed],max_output_size=size)
        if len(payload)!=size:raise ValueError('Catalog reference decompressed length differs')
        decoded[file]=payload;records.append({'path':file,'key':key,'entryHex':entry.hex(),'sha256':sha(payload),'bytes':size})
    distribution=importlib.metadata.distribution('cdtb')
    origin=json.loads(distribution.read_text('direct_url.json'))
    revision=origin['vcs_info']['commit_id']
    if revision!='3367589fdd3ee3d0d01383d2f98dba12b04d1371':raise ValueError('Pinned CDTB revision required')
    import cdtb.binfile as binfile
    for name in ['hashfile_binfields','hashfile_bintypes','hashfile_binentries','hashfile_binhashes','hashfile_binhashes_xxh3','hashfile_binpaths']:
        getattr(binfile,name).hashes={}
    stream=io.BytesIO(decoded['global/champions/champions.bin']);parsed=binfile.BinFile(stream)
    if parsed.is_patch or stream.tell()!=len(stream.getvalue()) or parsed.linked_files:
        raise ValueError('Expected complete unpatched standalone catalog BIN')
    objects=parsed.to_serializable();objects.pop('__linked',None)
    if any(not isinstance(row,dict) or row.get('__type')!='{ea595ca6}' for row in objects.values()):
        raise ValueError('Unexpected original Champion catalog object type')
    names=[row['{8d39bde6}'] for row in objects.values()]
    if native['catalog']['names']!=names or len(set(names))!=len(names):
        raise ValueError('Native catalog names/order differ from independent BIN decoding')
    data=decoded['global/champions/championskins.info'];cursor=0
    def read(size):
        nonlocal cursor
        if not 0<=size<=len(data)-cursor:raise ValueError('Skin-info reference exceeds input bounds')
        value=data[cursor:cursor+size];cursor+=size;return value
    def integer():return struct.unpack('<I',read(4))[0]
    def text():
        size=integer()
        if size>4096:raise ValueError('Skin-info string exceeds reference bounds')
        return read(size).decode('utf-8')
    if read(4)!=b'mahC' or integer()!=2:raise ValueError('Exact skin-info version 2 required')
    count=integer()
    if not 0<count<=1024:raise ValueError('Skin-info catalog count exceeds reference bounds')
    skin_names=[];skins=0
    for _ in range(count):
        skin_names.append(text());size=integer()
        if size>4096:raise ValueError('Skin-info skin count exceeds reference bounds')
        for _ in range(size):integer();read(1);text();skins+=1
    if cursor!=len(data) or len(set(skin_names))!=count or set(skin_names)!=set(names):
        raise ValueError('Skin-info reference names/consumption differ')
    implementation=[Path(zstandard.backend_c.__file__),Path(xxhash._xxhash.__file__),
        *[Path(distribution.locate_file(file)) for file in distribution.files
          if str(file).replace('\\','/').startswith('cdtb/') and str(file).endswith('.py')]]
    output=cache/'research/champion-catalog-comparison.json'
    result={'schema':1,'kind':'native-independent-champion-catalog-name-comparison',
            'build':native['build'],'inputs':{str(path):sha(raw),native['installedArchive']['path']:sha(archive)},
            'sourceSha256':sha(Path(__file__).read_bytes()),'cdtbRevision':revision,'decodedFiles':records,
            'counts':{'nativeEntries':len(names),'binObjects':len(objects),'skinInfoEntries':count,'skinInfoRows':skins},
            'namesAndOrderMatchBin':True,'nameSetMatchesSkinInfo':True,'bothReferenceInputsFullyConsumed':True,
            'scope':{'namesCompared':True,'allMetadataFieldsCompared':False,'skinVisualsVerified':False,'mainViewerExpanded':False}}
    result['inputs'].update({str(file.resolve()):sha(file.read_bytes()) for file in implementation})
    result['decoderVersions']={'zstandard':zstandard.__version__,'xxhash':xxhash.VERSION}
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts']}))


if __name__=='__main__':main()
