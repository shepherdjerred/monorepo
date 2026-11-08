"""GLES readback and original buffer-header ABI at the observed SKN size."""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from skinned_vertex_buffer_native import skn_vertex_input, upload_large_static_buffer
from graphics_mesh_device import GraphicsMeshDevice
from graphics_texture_device import GraphicsTextureDevice
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path); p.add_argument('client', type=Path)
    p.add_argument('--angle', required=True, type=Path)
    args = p.parse_args()
    f = NativeAIUnitFixture(args.cache, args.client)
    n = f.native
    source = f.raw(f.cache / 'public/latest-scene/champions/viego/43/model.skn')
    shape = skn_vertex_input(source)
    offset = 12 + struct.unpack_from('<I', source, 8)[0] * 80 + 60 + shape['indices'] * 2
    data = source[offset:offset+shape['bytes']]
    device = GraphicsTextureDevice(args.angle)
    backend = GraphicsMeshDevice(device)
    try:
        gpu = upload_large_static_buffer(backend, data, 0, shape['bytes'])
        header = n.allocate(0x58, 0xa5)
        n.call(0x1917a40, {r.UC_X86_REG_RDI: header, r.UC_X86_REG_RSI: shape['bytes'], r.UC_X86_REG_RDX: 0})
        if n.u32(header+8) != 0 or n.u32(header+12) != shape['bytes'] or n.u.mem_read(header+16,1) != b'\0' or bytes(n.u.mem_read(header+0x48,16)) != b'\xa5'*16:
            raise ValueError('Original SKN-size vertex-buffer header differs')
        rejected = 0
        for value in [source[:-1], source + b'\0', b'\0'*16]:
            try: skn_vertex_input(value)
            except ValueError: rejected += 1
            else: raise ValueError('Malformed SKN was admitted')
        for raw, flags, size in [(data,1,len(data)),(data,0,len(data)-1),(data[:100],0,100)]:
            try: upload_large_static_buffer(backend,raw,flags,size)
            except ValueError: rejected += 1
            else: raise ValueError('Invalid SKN GPU request admitted')
        record = {key:value for key,value in gpu.items() if key != 'bytesHex'}
    finally:
        backend.close(); device.close()
    for name in ['libEGL.dll','libGLESv2.dll']: f.raw(args.angle/name)
    paths = {Path(__file__), Path(inspect.getfile(skn_vertex_input)), Path(inspect.getfile(GraphicsMeshDevice)),
             Path(inspect.getfile(GraphicsTextureDevice)), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-header-skn-size-gpu-buffer-control','build':n.profile['clientVersion'],
              'decoderImageSha256':sha(n.image),'inputs':f.inputs,'sources':{str(p.resolve()):sha(p.read_bytes()) for p in paths},
              'shape':shape,'gpu':record,'originalHeaderHex':bytes(n.u.mem_read(header,0x48)).hex(),'rejected':rejected,
              'scope':{'actualGpuReadback':True,'originalBufferHeaderConstructor':True,
                       'suppliedStaticVertexBytes':True,'originalSkinnedCallerOwnershipEstablished':False,
                       'componentFactoryCompleted':False,'browserRendered':False}}
    out=f.cache/'research/skinned-vertex-buffer-native.json'
    out.write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(out),'bytes':shape['bytes'],'rejected':rejected}))


if __name__ == '__main__': main()
