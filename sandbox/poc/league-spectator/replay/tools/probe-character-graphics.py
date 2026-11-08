"""Observe original character resource constructors backed by real GLES bytes."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from character_graphics_native import NativeCharacterGraphics
from graphics_texture_device import GraphicsTextureDevice
from graphics_mesh_device import GraphicsMeshDevice
from vfx_graphics_native import NativeVfxGraphicsContext
from vfx_mesh_native import NativeVfxMeshContext
from native_ai_unit_fixture import NativeAIUnitFixture
from character_graph_snapshot import restore
from vfx_spawn_native import sha
from libcpp_string_native import assign_c_string


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:p.add_argument(name,type=Path)
    p.add_argument('--actor',help='Resume the selected actor graph texture-manager prefix')
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeCharacterGraphics)
    n,cache = fixture.native,fixture.cache
    fixture.raw(cache/'research/darwin-errlst.c')
    for name in ['libEGL.dll','libGLESv2.dll']:fixture.raw(args.angle/name)
    if args.actor:
        selected = fixture.read(cache/'research'/('character-asset-postload-'+args.actor.replace('/','-')+
                    '-types-23ea1915-45cd899f-9b67e9f6-ef3a0f33-f5fb07c7-native.json'))
        if not selected['scope']['completeSuppliedStage'] or selected['scope']['assetReadinessVerified']:
            raise ValueError('Matching scoped post-load snapshot required')
        for path,digest in selected['inputs'].items():
            if sha(fixture.raw(Path(path))) != digest:raise ValueError('Post-load graphics input changed: '+path)
        for name,digest in selected['sources'].items():
            if sha(fixture.raw(fixture.root/'tools'/name)) != digest:raise ValueError('Post-load graphics producer changed: '+name)
        restore(fixture,selected['snapshot'])
    graphics,boundary = None,None
    try:
        graphics = n.initialize_character_graphics(args.angle)
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper()))
                                 for key in ['rax','rbx','rcx','rdx','rdi','rsi','r12','r13','r14','r15','rbp','rsp']}}
    finally:
        n.close_graphics()
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(__file__).with_name('character_graph_snapshot.py'),
             Path(inspect.getfile(GraphicsTextureDevice)),Path(inspect.getfile(GraphicsMeshDevice)),
             Path(inspect.getfile(NativeVfxGraphicsContext)),Path(inspect.getfile(NativeVfxMeshContext)),
             Path(inspect.getfile(assign_c_string)),
             Path(__file__).with_name('render-particle-shader.py'),Path(__file__).with_name('observe-shader-angle.py'),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-character-graphics-constructor-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'actorKey':args.actor,
              'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'graphics':graphics,'boundary':boundary,
              'textureUploads':n.gpu_records,'buffers':list(n.native_mesh_buffers.values()),
              'scope':{'constructorsCompleted':graphics is not None,'realGlesResources':True,
                       'allGraphicsMethodsImplemented':False,'allAssetsReady':False,'mainViewerExpanded':False}}
    suffix = '-'+args.actor.replace('/','-') if args.actor else ''
    output = cache/'research'/('character-graphics'+suffix+'-native.json')
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'graphics':graphics,'textures':len(n.gpu_records),
                      'buffers':len(n.native_mesh_buffers),'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()
