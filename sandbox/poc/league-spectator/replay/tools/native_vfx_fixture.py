"""Prepare exact-build resources and activate an authored root for diagnostics.

This shared fixture owns static files/pixels only. Per-match inputs remain with
the caller; it neither launches League nor supplies missing scene resources.
"""
from pathlib import Path
from PIL import Image
from unicorn import x86_const as r
import json
from vfx_spawn_native import ADDRESSES as A,sha


class NativeVfxFixture:
    def __init__(self,cache):
        self.cache=cache.resolve();self.assets=self.cache/'public';self.inputs={}
        self.systems=self.read(self.assets/'latest-vfx-system-assets/package.json')
        effects=self.read(self.assets/'latest-effects/manifest.json')
        supplement=self.read(self.assets/'latest-native-textures/package.json')
        self.context=self.read(self.assets/'latest-vfx-resource-context/package.json')
        self.cubes=self.read(self.assets/'latest-dds-cubes/package.json')
        for package in [self.systems,effects,supplement,self.context,self.cubes]:
            if package['build']!='16.21.829.8620' or package['protocol']!='20e09df23c66b85e':
                raise ValueError('Native fixture input build/protocol differs')
        if len(self.systems['systems'])!=876 or not self.cubes['scope']['allAuthoredFacesAndMips']:
            raise ValueError('Native fixture requires complete prepared system/cube packages')
        for path,expected in self.cubes['inputs'].items():
            if sha(self.raw(Path(path)))!=expected:raise ValueError('Prepared cube input changed')
        for name,expected in self.cubes['sources'].items():
            if sha(self.raw(Path(__file__).with_name(name)))!=expected:raise ValueError('Prepared cube producer changed')
        self.catalog={p:{**v,'directory':self.assets/'latest-effects'} for p,v in effects['assets'].items()}
        for p,v in supplement['assets'].items():
            if p in self.catalog:raise ValueError('Supplement collides with original effect catalog')
            self.catalog[p]={**v,'directory':self.assets/'latest-native-textures'}
        self.static_files={}
        for path,ref in effects['assets'].items():
            if ref.get('kind')!='texture' and ref.get('rawFile'):
                data=self.raw(self.assets/'latest-effects'/ref['rawFile'])
                if sha(data)!=ref['sourceSha256']:raise ValueError('Native fixture static file changed')
                self.static_files[path]={'bytes':data,'sha256':sha(data)}

    def raw(self,path):
        data=path.read_bytes();self.inputs[str(path.resolve())]=sha(data);return data

    def read(self,path):return json.loads(self.raw(path))

    def activate(self,n,effect_id,seed,clock,quality,graphics34b):
        if effect_id not in self.systems['systems']:raise ValueError('Unprepared parent fixture effect')
        ref=self.systems['systems'][effect_id];path=self.assets/'latest-vfx-system-assets'/ref['file']
        graph=self.read(path)
        if sha(self.raw(path))!=ref['sha256'] or graph['effectId']!=effect_id:raise ValueError('Native fixture graph changed')
        n.load_prepared_system(graph)
        for g in self.context['initializedGlobals']:n.u.mem_write(n.base+g['rva'],bytes.fromhex(g['bytesHex']))
        n.initialize_graphics_context(quality,graphics34b);n.install_static_files(self.static_files)
        dependencies=n.discover_texture_paths(graph)
        for discovery in dependencies:
            asset=self.catalog.get(discovery['path'].lower())
            if not asset or asset.get('kind')!='texture' or asset.get('status')!='prepared':
                raise ValueError('Unprepared typed native fixture texture')
            source=self.raw(asset['directory']/asset['rawFile'])
            if sha(source)!=asset['sourceSha256']:raise ValueError('Native fixture source texture changed')
            if asset['rawFile'].endswith('.dds'):
                key=self.cubes['paths'][discovery['path'].lower()]
                if key!=sha(source):raise ValueError('Native fixture cube selects different source bytes')
                cube=self.cubes['cubes'][key];levels=[]
                for level in cube['levels']:
                    planes=[]
                    for plane in level:
                        pixels=self.raw(self.assets/'latest-dds-cubes'/plane['file'])
                        if sha(pixels)!=plane['sha256'] or len(pixels)!=plane['width']*plane['height']*4:
                            raise ValueError('Native fixture cube face/mip changed')
                        planes.append(pixels)
                    levels.append(planes)
                n.register_rgba_cube_texture(discovery['path'],levels,cube['width'])
            else:
                file=asset['directory']/asset['file'];png=self.raw(file)
                if sha(png)!=asset['sha256']:raise ValueError('Native fixture PNG changed')
                image=Image.open(file).convert('RGBA')
                if image.size!=(asset['width'],asset['height']):raise ValueError('Native fixture texture size changed')
                n.register_rgba_texture(discovery['path'],image.tobytes(),*image.size)
        n.supply_clock_inputs(clock['ticks'],clock['mode'],clock['timebase']);seed_record=n.set_random_seed(seed)
        obj=n.create_object();n.set_scalars(obj,0x3f800000,0x3f800000);n.mark_ready(obj)
        n.call(0x1765960,{r.UC_X86_REG_RDI:obj})
        parent=n.q(obj+0x28)
        if n.allocations.get(parent)!=0x2c0 or n.u32(A['manager']+0x188)!=1:
            raise ValueError('Native fixture did not publish exactly one parent')
        return {'effectId':effect_id,'graphSha256':ref['sha256'],'graph':graph,'object':obj,'parent':parent,
            'clockInput':clock,'randomSeed':seed_record,'textureDependencies':dependencies,
            'quality':quality,'graphics34b':graphics34b}
