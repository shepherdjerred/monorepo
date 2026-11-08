"""Preserve every authored face/mip of installed map effect DDS cubemaps."""
import argparse
import json
from pathlib import Path
import PIL
from PIL import Image
from dds_cube import decode_cube, FACE_NAMES
from vfx_spawn_native import sha


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    args=p.parse_args()
    assets=args.cache.resolve()/'public'
    root=assets/'latest-map-effect-assets'
    package_bytes=(root/'package.json').read_bytes()
    package=json.loads(package_bytes)
    if package['kind']!='prepared-map-effect-assets' or package['build']!='16.21.829.8620' or package['protocol']!='20e09df23c66b85e':
        raise ValueError('Exact-build map effect package required')
    output=assets/'latest-map-dds-cubes'
    (output/'planes').mkdir(parents=True,exist_ok=True)
    inputs={str((root/'package.json').resolve()):sha(package_bytes)}
    paths,cubes={},{}
    for path,ref in package['assets'].items():
        if not ref.get('rawFile','').endswith('.dds'):continue
        if ref['status']!='prepared' or ref['kind']!='texture':
            raise ValueError('Map cube was not independently texture-converted')
        source=root/ref['rawFile'];raw=source.read_bytes();digest=sha(raw)
        if digest!=ref['sourceSha256']:raise ValueError('Retained map DDS changed')
        inputs[str(source.resolve())]=digest
        paths[path]=digest
        if digest in cubes:continue
        cube=decode_cube(raw)
        preview=root/ref['file'];png=preview.read_bytes();image=Image.open(preview).convert('RGBA')
        if sha(png)!=ref['sha256'] or image.size!=(cube['width'],cube['height']) or image.tobytes()!=cube['levels'][0][0]['rgba']:
            raise ValueError('Map DDS first face differs from independent exporter')
        inputs[str(preview.resolve())]=sha(png)
        for level in cube['levels']:
            for plane in level:
                pixels=plane.pop('rgba');key=sha(pixels);file=f'planes/{key}.rgba'
                (output/file).write_bytes(pixels)
                plane.update(file=file,sha256=key,bytes=len(pixels))
        cube.update(sourceSha256=digest,rawFile=ref['rawFile'],firstFaceExporterCompared=True)
        cubes[digest]=cube
    result={'schema':1,'kind':'prepared-map-dds-cubemaps','build':package['build'],'protocol':package['protocol'],
        'mapAssetsSha256':sha(package_bytes),'inputs':inputs,
        'sources':{p.name:sha(p.read_bytes()) for p in [Path(__file__),Path(__file__).with_name('dds_cube.py')]},
        'decoder':{'library':'Pillow','version':PIL.__version__,'codec':'bcn/BC1'},'faceOrder':FACE_NAMES,
        'paths':paths,'cubes':cubes,'counts':{'paths':len(paths),'uniqueCubes':len(cubes),
            'subresources':sum(c['mips']*6 for c in cubes.values())},
        'scope':{'allAuthoredFacesAndMips':True,'firstFaceExporterCompared':True,'generatedMips':False,
            'originalDdsLoaderExecuted':False,'browserExecuted':False,'referenceCompared':False}}
    encoded=json.dumps(result,indent=2).encode()
    (output/'package.json').write_bytes(encoded)
    print(json.dumps({'sha256':sha(encoded),'counts':result['counts']}))


if __name__=='__main__':main()
