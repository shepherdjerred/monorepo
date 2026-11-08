"""Offline item labels/icons from the installed client plugin; no replay/network.

The metadata namespace and each image are read from owned WAD entries. The game
executable is pinned; source hashes identify the accompanying client resources.
Reference HUD icon selection and material/color processing remain unverified.
"""
import argparse,json,hashlib,importlib.metadata,struct
from pathlib import Path
from xxhash import xxh64_intdigest
from cdtb.wad import Wad

def sha(data):return hashlib.sha256(data).hexdigest()
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for k in ['installation','cache']:p.add_argument(k,type=Path)
    a=p.parse_args();cache=a.cache.resolve();root=a.installation.resolve();revision='3367589fdd3ee3d0d01383d2f98dba12b04d1371'
    source=json.loads(importlib.metadata.distribution('cdtb').read_text('direct_url.json'))
    if source['vcs_info']['commit_id']!=revision:raise ValueError('CDTB revision mismatch')
    game_sha=sha((root/'Game/League of Legends.exe').read_bytes())
    if game_sha!='6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a':raise ValueError('Installed build changed')
    plugin=root/'Plugins/rcp-be-lol-game-data';wads=[Wad(plugin/n,hashes={})for n in ['default-assets.wad','default-assets2.wad']]
    indices={id(w):{f.path_hash:f for f in w.files}for w in wads};inputs={}
    for w in wads:
        with open(w.path,'rb')as stream:raw=stream.read(272+32*len(w.files))
        with open(w.path,'rb')as stream:whole_sha=hashlib.file_digest(stream,'sha256').hexdigest()
        inputs[str(Path(w.path).resolve())]={'sha256':whole_sha,'indexSha256':sha(raw),'bytes':Path(w.path).stat().st_size}
    assets={}
    def read(path):
        hits=[(w,indices[id(w)][xxh64_intdigest(path.lower())])for w in wads if xxh64_intdigest(path.lower())in indices[id(w)]]
        if not hits:raise ValueError('Missing installed item asset: '+path)
        values=[]
        for w,f in hits:
            if f.type==4 and w.subchunk_toc is None:raise ValueError('Required item subchunk TOC unavailable')
            with open(w.path,'rb')as stream:data=f.read_data(stream,w.subchunk_toc)
            if data is None or len(data)!=f.size:raise ValueError('Invalid installed item entry')
            values.append(data)
        if any(v!=values[0]for v in values):raise ValueError('Conflicting installed item asset')
        assets[path]={'sha256':sha(values[0]),'bytes':len(values[0]),'archives':[str(Path(w.path).resolve())for w,f in hits]}
        return values[0]
    metadata_path='plugins/rcp-be-lol-game-data/global/default/v1/items.json';metadata=read(metadata_path);items=json.loads(metadata)
    out=cache/'public/latest-items';(out/'icons').mkdir(parents=True,exist_ok=True);catalog={};icons={}
    for item in items:
        key=item['id'];uri=item['iconPath'];name=item['name']
        if type(key)is not int or key<0 or str(key)in catalog or not isinstance(name,str)or not uri.startswith('/lol-game-data/assets/'):
            raise ValueError('Invalid item identity/presentation')
        path='plugins/rcp-be-lol-game-data/global/default/'+uri.removeprefix('/lol-game-data/assets/').lower()
        if '..'in path.split('/'):raise ValueError('Unsafe item icon path')
        data=read(path)
        if data[:8]!=b'\x89PNG\r\n\x1a\n':raise ValueError('Unsupported item icon encoding')
        width,height=struct.unpack_from('>II',data,16)
        if not 0<width<=2048 or not 0<height<=2048:raise ValueError('Unsupported item icon dimensions')
        image_sha=sha(data);file='icons/'+image_sha+'.png';(out/file).write_bytes(data);icons[file]=image_sha
        catalog[str(key)]={'id':key,'name':name if name else None,'nameStatus':'authored'if name else'unavailable',
            'icon':file,'iconSha256':image_sha,'width':width,'height':height,'sourcePath':path}
    meta={'schema':1,'kind':'installed-item-presentation','build':'16.21.829.8620','protocol':'20e09df23c66b85e',
        'gameExecutableSha256':game_sha,'metadataPath':metadata_path,'metadataSha256':sha(metadata),'items':catalog,
        'scope':{'installedItemMetadataAndIcons':True,'referenceHudCompared':False,'nativeIconSelectionVerified':False}}
    raw=json.dumps(meta,indent=2).encode();(out/'package.json').write_bytes(raw)
    proof={'schema':1,'packageSha256':sha(raw),'preparerSha256':sha(Path(__file__).read_bytes()),'cdtbRevision':revision,
        'wadParserSha256':sha(Path(importlib.metadata.distribution('cdtb').locate_file('cdtb/wad.py')).read_bytes()),
        'inputs':inputs,'assets':assets,'counts':{'items':len(catalog),'icons':len(icons)}}
    (cache/'research/item-assets-native.json').write_text(json.dumps(proof,indent=2),encoding='utf-8')
    print(json.dumps({'packageSha256':sha(raw),'counts':proof['counts']}))
if __name__=='__main__':main()
