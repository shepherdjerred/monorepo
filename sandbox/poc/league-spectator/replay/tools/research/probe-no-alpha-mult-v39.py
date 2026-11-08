"""Bounded original selector and real linked GLES no-alpha MULT contract.

Cache-only research. No renderer admission, match rendering or native-world
pixel parity is established by this control.
"""
import ctypes as C
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
TOOLS = ROOT / 'sandbox/poc/league-spectator/replay/tools'
sys.path.insert(0, str(TOOLS))
from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import ADDRESSES as A, sha

spec = importlib.util.spec_from_file_location('no_alpha_draw', TOOLS / 'render-particle-shader.py')
gpu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gpu)
INPUTS = {}


def raw(path, expected=None):
    path = Path(path).resolve()
    data = path.read_bytes()
    digest = sha(data)
    if expected is not None and digest != expected:
        raise ValueError('Exact selected input differs: ' + str(path))
    if str(path) in INPUTS and INPUTS[str(path)] != digest:
        raise ValueError('Input changed during proof')
    INPUTS[str(path)] = digest
    return data


def read(path, expected=None):
    return json.loads(raw(path, expected))


ENV = dict(pass_=0, featuresEnabled=True, resourceMask=1, systemFogMode=1, graphics34b=False, graphics29c=0)
ENV['pass'] = ENV.pop('pass_')
VERTEX = '903a023260c71aa435f3edcfaf6eebf4d2b4c864c490c95103aff8c95087e314'
PIXEL = '568fd279eefb3f35c202e320d7e5c7ac7b18f8c5869c5c834b4c8e587d369621'
DEFINES = [{'name': 'DISABLE_FOW', 'value': '1'}, {'name': 'MULT_PASS', 'value': '1'}]


def main():
    angle = Path('C:/Users/Jerred/AppData/Local/Programs/cursor')
    primary = ROOT / '.cache/replay-spike'
    client = primary / 'research/LeagueofLegends-macos'
    n = NativeVfxMaterial(primary / 'public/decoder-16.21-macos', client)
    d = gpu.Draw(angle)
    d.fn(d.gl, 'glGetActiveUniformBlockiv', None, C.c_uint, C.c_uint, C.c_uint, C.POINTER(C.c_int))
    d.fn(d.gl, 'glGetActiveUniformBlockName', None, C.c_uint, C.c_uint, C.c_int, C.POINTER(C.c_int), C.c_void_p)
    d.fn(d.gl, 'glGetActiveUniform', None, C.c_uint, C.c_uint, C.c_int, C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_uint), C.c_void_p)
    rows, programs = [], []
    try:
        for cache_name, effect_id, index, sort_pass in [
            ('replay-spike', 'champions/akshan/20/d213225a', 4, 11),
            ('replay-lineup-5667809143', 'champions/sona/75/c549d272', 6, 120),
        ]:
            cache = ROOT / '.cache' / cache_name
            assets = cache / 'public'
            decoder = assets / 'decoder-16.21-macos'
            profile = read(decoder / 'profile.json')
            image = raw(decoder / 'image.bin', '3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7')
            package = read(assets / 'latest-complete-quad-gpu/package.json')
            manifest = read(assets / 'latest-effects/manifest.json', package['effectsManifestSha256'])
            native = read(cache / 'research/vfx-materials-native.json', package['nativeMaterialSha256'])
            for block in native['originalBlocks']:
                if sha(image[block['rva']:block['rva'] + block['size']]) != block['sha256']:
                    raise ValueError('Original selector instructions differ')
            prepared = next(r for r in package['emitters'] if r['effectId'] == effect_id and r['emitterIndex'] == index)
            observation = next(r for r in native['emitters'] if r['effectId'] == effect_id and r['emitterIndex'] == index)
            definition = read(assets / 'latest-effects' / manifest['definitions'][effect_id]['file'], prepared['sourceDefinitionSha256'])
            source = definition['definition']['complexEmitterDefinitionData'][index]
            if type(source['alphaRef']) not in [int, float] or source['alphaRef'] != 0 or type(source['blendMode']) is not int or source['blendMode'] != 4:
                raise ValueError('Typed actual alphaRef zero / blendMode4 required')
            if prepared['environment'] != ENV or prepared['defines'] != DEFINES or prepared['nativeDefines'] != DEFINES:
                raise ValueError('Exact absent ALPHA_TEST pass0 variant required')
            if prepared['shaders']['vertex']['sha256'] != VERTEX or prepared['shaders']['pixel']['sha256'] != PIXEL:
                raise ValueError('Unapproved no-alpha shader pair')
            if prepared['nativeBlendFactors'] != [6, 6, 1, 1] or not prepared['suppliedDepthTest'] or prepared['suppliedDoubleSide'] or prepared['suppliedSortPass'] != sort_pass:
                raise ValueError('Native pipeline contract differs')
            graph = read(decoder / observation['graphFile'], observation['graphSha256'])
            controls = []
            for alpha in [0, 1, 128, 255]:
                n.prepare_material(graph)
                original_alpha = n.u.mem_read(A['definition'] + 0x77, 1)[0]
                if original_alpha != 0:
                    raise ValueError('Actual original alphaRef byte differs')
                n.put(A['definition'] + 0x77, 'B', alpha)
                before = bytes(n.u.mem_read(A['definition'], 0x470))
                selection = n.select(ENV)
                state = n.render_state(0)
                if before != bytes(n.u.mem_read(A['definition'], 0x470)):
                    raise ValueError('Selector mutated source')
                # ALPHA_TEST is appended by original render-state construction,
                # after the initial shader macro selection container exists.
                names = {r['name'] for r in state['defines']}
                if ('ALPHA_TEST' in names) != bool(alpha):
                    raise ValueError('Original alpha branch disagrees')
                if alpha == 0 and (selection['defines'] != DEFINES or state['bytesHex'] != prepared['nativeRenderStateHex']):
                    raise ValueError('Actual native no-alpha selection/state differs')
                controls.append({'alphaRefByte': alpha, 'originalAlphaRefByte': original_alpha, 'selection': selection, 'state': state})
            stages = {key: read(assets / 'latest-shaders' / ref['file'], ref['sha256']) for key, ref in prepared['shaders'].items()}
            handle = d.program(stages['vertex'], stages['pixel'])
            programs.append(handle)
            count = C.c_int()
            d.gl.glGetProgramiv(handle, 0x8a36, C.byref(count))
            blocks = []
            for at in range(count.value):
                name = C.create_string_buffer(512)
                length, size = C.c_int(), C.c_int()
                d.gl.glGetActiveUniformBlockName(handle, at, len(name), C.byref(length), name)
                d.gl.glGetActiveUniformBlockiv(handle, at, 0x8a40, C.byref(size))
                blocks.append({'name': name.value.decode(), 'size': size.value})
            provided = {r['glslName']: r['size'] for r in prepared['blocks']}
            if set(provided) != {r['name'] for r in blocks} or any(provided[r['name']] < r['size'] for r in blocks):
                raise ValueError('Strict active UBO inventory incompatible')
            d.gl.glGetProgramiv(handle, 0x8b86, C.byref(count))
            samplers = []
            for at in range(count.value):
                name = C.create_string_buffer(512)
                length, size, kind = C.c_int(), C.c_int(), C.c_uint()
                d.gl.glGetActiveUniform(handle, at, len(name), C.byref(length), C.byref(size), C.byref(kind), name)
                if kind.value in [0x8b5e, 0x8b5f, 0x8b60, 0x8dca, 0x8dd2]:
                    samplers.append({'name': name.value.decode(), 'size': size.value, 'glType': kind.value})
            expected_samplers = {s['glslName'] for stage in stages.values() for t in stage['sidecar']['textures'] for s in t['samplers']}
            if expected_samplers != {r['name'] for r in samplers} or any(r['size'] != 1 or r['glType'] != 0x8b5e for r in samplers):
                raise ValueError('Exact active float sampler2D contract differs')
            if d.gl.glGetError():
                raise ValueError('Native linked reflection GL error')
            rows.append({'cache': cache_name, 'materialKey': f'{effect_id}:{index}', 'source': {'alphaRef': source['alphaRef'], 'blendMode': source['blendMode']}, 'ownedSortPass': sort_pass, 'controls': controls, 'providedBlocks': provided, 'activeBlocks': blocks, 'activeSamplers': samplers, 'shaderPair': {'vertex': VERTEX, 'pixel': PIXEL}})
        for module in tuple(sys.modules.values()):
            path = getattr(module, '__file__', None)
            if path and Path(path).suffix == '.py' and Path(path).resolve().is_relative_to(TOOLS):
                raw(path)
        for path in [Path(__file__), client, angle / 'libEGL.dll', angle / 'libGLESv2.dll']:
            raw(path)
        for path, digest in INPUTS.items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('Final source changed during proof')
        output = primary / 'research/no-alpha-mult-native-reflection-v39.json'
        report = {'schema': 1, 'kind': 'original-no-alpha-mult-selector-and-linked-gles-reflection', 'inputs': INPUTS, 'context': d.info, 'rows': rows, 'originalBlocks': list(n.material_blocks.values()), 'counts': {'materials': len(rows), 'originalAlphaControls': sum(len(r['controls']) for r in rows)}, 'scope': {'originalSourceAndControlledAlphaSelector': True, 'strictLinkedUboAndSamplerInventory': True, 'drawPerformed': False, 'productionAdmissionChanged': False, 'matchRenderedCoverage': False, 'browserAcceptance': False, 'nativeWorldParity': False}}
        output.write_text(json.dumps(report, indent=2))
        print(json.dumps({'output': str(output), 'counts': report['counts'], 'activeBlocks': rows[0]['activeBlocks'], 'activeSamplers': rows[0]['activeSamplers']}), flush=True)
    finally:
        for handle in programs:
            d.gl.glDeleteProgram(handle)
        d.close()


if __name__ == '__main__':
    main()
