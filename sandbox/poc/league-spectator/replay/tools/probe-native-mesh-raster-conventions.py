"""Original Metal winding/viewport message arguments; no GPU or pipeline mutation."""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from native_pipeline_description import NativePipelineDescription
from vfx_spawn_native import sha


class NativeRasterConventions(NativePipelineDescription):
    def __init__(self, *args):
        self.encoder_active = False
        super().__init__(*args)

    def message(self, uc, address, size, user):
        if not self.encoder_active:
            return super().message(uc, address, size, user)
        receiver = self.u.reg_read(r.UC_X86_REG_RDI)
        selector = self.cstring(self.u.reg_read(r.UC_X86_REG_RSI)).decode('ascii')
        if receiver != self.encoder or selector not in {
                'setCullMode:', 'setFrontFacingWinding:', 'setViewport:'}:
            raise ValueError('Unexpected original raster API message')
        value = self.u.reg_read(r.UC_X86_REG_RDX)
        event = {'selector': selector, 'receiver': receiver,
                 'originalReturnRva': self.q(self.u.reg_read(r.UC_X86_REG_RSP)) - self.base}
        if selector == 'setViewport:':
            event['viewport'] = list(struct.unpack('<6d', self.u.mem_read(
                self.u.reg_read(r.UC_X86_REG_RSP) + 8, 48)))
        else:
            event['value'] = value
        self.encoder_messages.append(event)
        self.u.reg_write(r.UC_X86_REG_RAX, 0)
        self.ret()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    assets = cache / 'public'
    n = NativeRasterConventions(assets / 'decoder-16.21-macos', args.client)
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    inputs = {str(p.resolve()): sha(p.read_bytes()) for p in paths}
    for name in ['profile.json', 'image.bin']:
        p = assets / 'decoder-16.21-macos' / name
        inputs[str(p.resolve())] = sha(p.read_bytes())
    n.load_system([])
    n.encoder = n.allocate(8)
    context, raster, raw, viewport = [n.allocate(size) for size in [0x1000, 0x178, 32, 24]]
    n.u.mem_write(context, bytes(0x1000))
    n.put(context, 'Q', n.encoder)
    n.put(context + 0x1e8, 'Q', n.encoder)
    n.encoder_messages = []
    winding = []
    for raw15 in [0, 1]:
        descriptor = bytearray(32)
        descriptor[4], descriptor[15] = 0x10, raw15
        n.u.mem_write(raw, bytes(descriptor))
        n.fragment(0x192aadf, 0x192ab39, {
            r.UC_X86_REG_R14: raster, r.UC_X86_REG_R15: raw, r.UC_X86_REG_RAX: 0})
        values = {'cull': n.q(raster + 0x40), 'winding': n.q(raster + 0x48)}
        n.encoder_active = True
        try:
            n.fragment(0x1927677, 0x192768e, {
                r.UC_X86_REG_RBX: context, r.UC_X86_REG_RDX: values['cull']})
            n.fragment(0x192769f, 0x19276b6, {
                r.UC_X86_REG_RBX: context, r.UC_X86_REG_RDX: values['winding']})
        finally:
            n.encoder_active = False
        messages = n.encoder_messages[-2:]
        if values != {'cull': 2, 'winding': int(raw15 == 0)} or [m.get('value') for m in messages] != [2, int(raw15 == 0)]:
            raise ValueError('Original cull/winding descriptor-to-encoder route differs')
        winding.append({'descriptorHex': descriptor.hex(), 'raster': values, 'messages': messages})
    viewports = []
    for rectangle in [(0, 0, 1280, 720), (19, 37, 659, 397)]:
        n.put(viewport, '4I2f', *rectangle, 0, 1)
        n.encoder_active = True
        try:
            n.fragment(0x1927210, 0x1927325, {
                r.UC_X86_REG_RDI: context, r.UC_X86_REG_RSI: viewport})
        finally:
            n.encoder_active = False
        expected = [rectangle[0], rectangle[1], rectangle[2]-rectangle[0], rectangle[3]-rectangle[1], 0, 1]
        message = n.encoder_messages[-1]
        if message['selector'] != 'setViewport:' or message['viewport'] != expected:
            raise ValueError('Original positive Metal viewport conversion differs')
        viewports.append({'inputRectangle': rectangle, 'inputDepth': [0, 1], 'message': message})
    for p, digest in inputs.items():
        if sha(Path(p).read_bytes()) != digest:
            raise ValueError('Raster convention observation source drift')
    out = cache / 'research/native-mesh-raster-conventions.json'
    result = {'schema': 1, 'kind': 'original-metal-raster-api-conventions',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'winding': winding, 'viewports': viewports,
              'originalBlocks': list(n.blocks.values()), 'inputs': inputs,
              'apiReferences': [
                  'https://developer.apple.com/documentation/metal/mtlrendercommandencoder/setfrontfacing(_:)',
                  'https://developer.apple.com/library/archive/documentation/Miscellaneous/Conceptual/MetalProgrammingGuide/Render-Ctx/Render-Ctx.html'],
              'scope': {'originalDescriptorAndEncoderInstructions': True,
                        'dataOnlyObjCReceiver': True, 'actualMetalExecuted': False,
                        'gpuCullEquivalenceProven': False, 'glesWindingMappingChanged': False,
                        'nativeWindowOrigin': 'upper-left', 'glesWindowOrigin': 'lower-left',
                        'windowOriginStatementSource': 'Apple Metal Programming Guide; OpenGL ES convention',
                        'sourceFingerprintsVerifiedBeforeAndAfter': True}}
    out.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(out), 'windingControls': len(winding),
                      'viewportControls': len(viewports), 'inputs': len(inputs)}))


if __name__ == '__main__':
    main()
