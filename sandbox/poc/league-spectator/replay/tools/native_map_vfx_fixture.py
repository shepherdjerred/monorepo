"""Complete map assets through the existing original effect activation pipeline.

This uses the map namespace exclusively. Missing textures, unresolved native
links and unsupported resources fail at their existing boundaries. Map variant,
guest state, entity providers and replay creation are not supplied.
"""
from pathlib import Path
from PIL import Image
from unicorn import x86_const as r
from native_vfx_fixture import NativeVfxFixture
from vfx_spawn_native import ADDRESSES as A,sha


class NativeMapVfxFixture(NativeVfxFixture):
    def __init__(self,cache):
        self.cache=cache.resolve();self.assets=self.cache/'public';self.inputs={}
        self.system_directory=self.assets/'latest-map-vfx-systems'
        self.asset_directory=self.assets/'latest-map-effect-assets'
        self.cube_directory=self.assets/'latest-map-dds-cubes'
        self.systems=self.read(self.system_directory/'package.json')
        effects=self.read(self.asset_directory/'package.json')
        self.context=self.read(self.assets/'latest-vfx-resource-context/package.json')
        self.cubes=self.read(self.cube_directory/'package.json')
        for package in [self.systems,effects,self.context,self.cubes]:
            if package['build']!='16.21.829.8620' or package['protocol']!='20e09df23c66b85e':
                raise ValueError('Map fixture build/protocol differs')
        if (self.systems['kind']!='native-complete-map-vfx-systems' or
                effects['kind']!='prepared-map-effect-assets' or self.cubes['kind']!='prepared-map-dds-cubemaps' or
                effects['mapSystemsSha256']!=sha((self.system_directory/'package.json').read_bytes()) or
                self.cubes['mapAssetsSha256']!=sha((self.asset_directory/'package.json').read_bytes()) or
                not self.cubes['scope']['allAuthoredFacesAndMips']):
            raise ValueError('Map fixture resource namespaces/identity differ')
        for package in [self.systems,effects,self.cubes]:
            for name,digest in package.get('compilerSources',package.get('sources',{})).items():
                if sha(self.raw(Path(__file__).with_name(name)))!=digest:
                    raise ValueError('Map fixture producer changed: '+name)
        for path,expected in self.cubes['inputs'].items():
            if sha(self.raw(Path(path)))!=expected:raise ValueError('Prepared map cube input changed')
        self.catalog=effects['assets']
        self.effect_dependencies=effects['effects']
        self.static_files={}
        for path,ref in self.catalog.items():
            if ref.get('kind')!='texture' and ref.get('rawFile'):
                data=self.raw(self.asset_directory/ref['rawFile'])
                if sha(data)!=ref['sourceSha256']:raise ValueError('Map fixture static file changed')
                self.static_files[path]={'bytes':data,'sha256':sha(data)}

    def activate(self,n,effect_id,seed,clock,quality,graphics34b):
        if effect_id not in self.systems['systems']:raise ValueError('Unprepared map fixture root')
        ref=self.systems['systems'][effect_id];path=self.system_directory/ref['file']
        graph=self.read(path)
        if sha(self.raw(path))!=ref['sha256'] or graph['effectId']!=effect_id:
            raise ValueError('Complete map graph changed')
        if graph['build']!=self.systems['build'] or graph['protocol']!=self.systems['protocol']:
            raise ValueError('Map graph build differs')
        # Existing strict admission rejects pending links/math and skipped fields.
        n.load_prepared_system(graph)
        for g in self.context['initializedGlobals']:
            n.u.mem_write(n.base+g['rva'],bytes.fromhex(g['bytesHex']))
        n.initialize_graphics_context(quality,graphics34b)
        required_files={path:self.static_files[path] for path in self.effect_dependencies[effect_id]['dependencies']
            if path in self.static_files}
        if required_files:
            n.install_static_files(required_files)
        dependencies=n.discover_texture_paths(graph)
        for discovery in dependencies:
            path=discovery['path'].lower()
            asset=self.catalog.get(path)
            if not asset or asset.get('kind')!='texture' or asset.get('status')!='prepared':
                raise ValueError('Unprepared typed native map texture: '+path)
            source=self.raw(self.asset_directory/asset['rawFile'])
            if sha(source)!=asset['sourceSha256']:raise ValueError('Map source texture changed')
            if asset['rawFile'].endswith('.dds'):
                key=self.cubes['paths'][path]
                if key!=sha(source):raise ValueError('Map cube selects another source')
                cube=self.cubes['cubes'][key];levels=[]
                for level in cube['levels']:
                    planes=[]
                    for plane in level:
                        pixels=self.raw(self.cube_directory/plane['file'])
                        if sha(pixels)!=plane['sha256'] or len(pixels)!=plane['width']*plane['height']*4:
                            raise ValueError('Map cube face/mip changed')
                        planes.append(pixels)
                    levels.append(planes)
                n.register_rgba_cube_texture(discovery['path'],levels,cube['width'])
            else:
                file=self.asset_directory/asset['file'];png=self.raw(file)
                if sha(png)!=asset['sha256']:raise ValueError('Map PNG changed')
                image=Image.open(file).convert('RGBA')
                if image.size!=(asset['width'],asset['height']):raise ValueError('Map texture size changed')
                n.register_rgba_texture(discovery['path'],image.tobytes(),*image.size)
        n.supply_clock_inputs(clock['ticks'],clock['mode'],clock['timebase'])
        seed_record=n.set_random_seed(seed)
        obj=n.create_object();n.set_scalars(obj,0x3f800000,0x3f800000);n.mark_ready(obj)
        n.call(0x1765960,{r.UC_X86_REG_RDI:obj})
        parent=n.q(obj+0x28)
        if n.allocations.get(parent)!=0x2c0 or n.u32(A['manager']+0x188)!=1:
            raise ValueError('Map fixture did not publish exactly one parent')
        return {'effectId':effect_id,'graphSha256':ref['sha256'],'graph':graph,'object':obj,'parent':parent,
            'clockInput':clock,'randomSeed':seed_record,'textureDependencies':dependencies,
            'quality':quality,'graphics34b':graphics34b}
