"""Prepare the exact-build ABI for CPU-only use of warmed parent resources."""
import argparse
import json
from pathlib import Path
from macho import MachImage
from vfx_spawn_native import sha
from vfx_graphics_native import SERVICE,DEVICE,CALLBACKS
from vfx_pipeline_native import PIPELINE_DEVICE_VTABLE

HOST_IMPORTS=['_pthread_mutex_init','_pthread_mutex_lock','_pthread_mutex_unlock',
    '_pthread_mutexattr_init','_pthread_mutexattr_settype','_pthread_mutexattr_destroy',
    '__tlv_atexit','_memset_pattern16','_strlen','_strcmp','___bzero','____chkstk_darwin']


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);p.add_argument('client',type=Path);args=p.parse_args()
    cache=args.cache.resolve();assets=cache/'public';inputs={}
    def raw(path):
        b=path.read_bytes();inputs[str(path.resolve())]=sha(b);return b
    def read(path):return json.loads(raw(path))
    profile=read(assets/'decoder-16.21-macos/profile.json');spawn=read(assets/'decoder-16.21-macos/vfx-spawn.json')
    package_raw=raw(assets/'latest-parent-frame-caches/package.json');package=json.loads(package_raw)
    proof=read(cache/'research/parent-frames-inspection.json')
    source=MachImage(raw(args.client));image=raw(assets/'decoder-16.21-macos/image.bin')
    if (profile['clientVersion']!='16.21.829.8620' or profile['protocolDigest']!='20e09df23c66b85e' or
            sha(image)!=profile['decoderImageSha256'] or sha(source.binary)!='6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b' or
            proof['mismatchCount'] or proof['cachePackageSha256']!=sha(package_raw) or
            package['observationSha256']!=proof['observationSha256'] or len(package['caches'])!=10 or
            sha(raw(assets/'decoder-16.21-macos/vfx-spawn.json'))!=profile['vfxSpawnSha256']):
        raise ValueError('Unmatched parent source/cache/native inspection')
    host={}
    for name in HOST_IMPORTS:
        matches=[at for at,symbol in source.imports.items() if symbol==name]
        if len(matches)!=1:raise ValueError('Missing/ambiguous parent host ABI import: '+name)
        host[name]=matches[0]
    types_raw=raw(assets/'decoder-16.21-macos/vfx-assets.json')
    if sha(types_raw)!=profile['vfxAssetsSha256']:raise ValueError('Original parent reflection metadata changed')
    types=json.loads(types_raw)['types']
    for name in ['vfx_graphics_native.py','vfx_pipeline_native.py']:raw(Path(__file__).with_name(name))
    result={'schema':1,'kind':'prepared-parent-cpu-runtime-abi','build':profile['clientVersion'],'protocol':profile['protocolDigest'],
        'decoderImageSha256':sha(image),'sliceSha256':sha(source.binary),'spawnSha256':profile['vfxSpawnSha256'],
        'parentCachePackageSha256':sha(package_raw),'nativeObservationSha256':proof['observationSha256'],
        'runtimeSha256':'d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716',
        'inputs':inputs,'preparerSha256':sha(Path(__file__).read_bytes()),'hostImports':host,
        'ownedStringFreeRva':0x1478f10,'threadDestructorRva':0x2e2dd0,
        'threadDestructorRegistrationSites':[0x1490fae,0x149103d,0x1491099],
        'additionalMathImports':{'_modff':0x1feea6e,'_expf':0x1fee81c},
        'cachedDeviceMetadata':{'entry':CALLBACKS['device'],'service':SERVICE,'device':DEVICE,'deviceVtable':PIPELINE_DEVICE_VTABLE},
        'rootType':types['45cd899f'],'emitterType':types['09cde442'],
        'scope':{'cpuOnly':True,'staticResourceMetadata':True,'perMatchExecution':False,
            'portableGraphicsHandles':False,'foreignHostCallbacksMustFail':True,'browserRun':False}}
    for name,at in result['additionalMathImports'].items():
        if source.imports.get(at)!=name:raise ValueError('Parent math import differs')
    out=assets/'latest-parent-frame-runtime';out.mkdir(exist_ok=True);encoded=json.dumps(result,indent=2).encode();(out/'package.json').write_bytes(encoded)
    print(json.dumps({'sha256':sha(encoded),'cachePackageSha256':sha(package_raw),'hostImports':host}))


if __name__=='__main__':main()
