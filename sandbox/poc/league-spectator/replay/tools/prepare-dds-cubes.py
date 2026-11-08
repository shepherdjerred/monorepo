"""Prepare exact-build static cubemap faces/mips from retained original DDS."""
import argparse
import hashlib
import json
from pathlib import Path
import PIL
from PIL import Image
from dds_cube import decode_cube,FACE_NAMES


def sha(raw):return hashlib.sha256(raw).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('cache',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public';root=assets/'latest-effects'
    manifest_bytes=(root/'manifest.json').read_bytes();manifest=json.loads(manifest_bytes)
    if (manifest['build']!='16.21.829.8620' or
            sha(manifest_bytes)!='ca91a5a7e79c408d195765a71909e92f9f8c086eb4555cfce7a26cbef03afeb0'):
        raise ValueError('Frozen exact-build effect manifest changed')
    out=assets/'latest-dds-cubes';(out/'planes').mkdir(parents=True,exist_ok=True)
    inputs={str((root/'manifest.json').resolve()):sha(manifest_bytes)};cubes={};paths={}
    for path,ref in manifest['assets'].items():
        if not ref.get('rawFile','').endswith('.dds'):continue
        raw_path=root/ref['rawFile'];raw=raw_path.read_bytes();key=sha(raw)
        if key!=ref['sourceSha256']:raise ValueError('Retained DDS source changed')
        inputs[str(raw_path.resolve())]=key;paths[path]=key
        if key in cubes:continue
        cube=decode_cube(raw)
        png_path=root/ref['file'];png=png_path.read_bytes();inputs[str(png_path.resolve())]=sha(png)
        image=Image.open(png_path).convert('RGBA')
        if sha(png)!=ref['sha256'] or image.size!=(cube['width'],cube['height']) or image.tobytes()!=cube['levels'][0][0]['rgba']:
            raise ValueError('DDS first face differs from independently prepared exporter PNG')
        for level in cube['levels']:
            for plane in level:
                pixels=plane.pop('rgba');digest=sha(pixels);file=f'planes/{digest}.rgba';preview=f'planes/{digest}-{plane["width"]}.png'
                (out/file).write_bytes(pixels)
                Image.frombytes('RGBA',(plane['width'],plane['height']),pixels).save(out/preview)
                plane.update(file=file,sha256=digest,bytes=len(pixels),preview=preview,previewSha256=sha((out/preview).read_bytes()))
        cube.update(sourceSha256=key,rawFile=ref['rawFile'],firstFaceExporterCompared=True)
        cubes[key]=cube
    if len(cubes)!=3:raise ValueError('Unexpected exact-build DDS cube inventory')
    result={'schema':1,'kind':'prepared-dds-cubemaps','build':manifest['build'],'protocol':'20e09df23c66b85e',
        'inputs':inputs,'sources':{p.name:sha(p.read_bytes()) for p in [Path(__file__),Path(__file__).with_name('dds_cube.py')]},
        'decoder':{'library':'Pillow','version':PIL.__version__,'codec':'bcn/BC1'},'faceOrder':FACE_NAMES,
        'paths':paths,'cubes':cubes,'counts':{'paths':len(paths),'uniqueCubes':len(cubes),
            'subresources':sum(c['mips']*6 for c in cubes.values())},
        'scope':{'allAuthoredFacesAndMips':True,'firstFaceExporterCompared':True,'generatedMips':False,
            'originalDdsLoaderExecuted':False,'browserExecuted':False,'referenceCompared':False}}
    encoded=json.dumps(result,indent=2).encode();(out/'package.json').write_bytes(encoded)
    print(json.dumps({'sha256':sha(encoded),'counts':result['counts']}))


if __name__=='__main__':main()
