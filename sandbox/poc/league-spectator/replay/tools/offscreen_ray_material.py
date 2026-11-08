"""Consume exported owned Ray resources without repacking their uniforms."""
import numpy as np
from offscreen_ray import adapter


def prepare_ray_material(renderer, material_device, pipeline_device, bound, raster):
    stages = bound['stages']
    program = renderer.program(*stages)
    pipeline = pipeline_device.create(bytes.fromhex(bound['pipeline']['descriptorHex']),
                                      {'linked': True, 'glHandle': program})
    if (pipeline['state'] != bound['pipeline']['state'] or
            raster['sourceState'] != pipeline['state'] or
            raster['policy'] != 'metal-upper-left-to-gles-lower-left-unchanged-ndc-v1' or
            not raster['windingReversed'] or raster['cullModeChanged']):
        raise ValueError('Original Ray pipeline and viewport conversion required')
    pipeline = {**pipeline, 'state': raster['state']}
    textures = {}
    for supplied in bound['textures']:
        t, levels = supplied['metadata'], supplied['levelsHex']
        if (t['pixelFormat'] != 'RGBA8' or len(levels) != 1 or len(levels[0]) != 1 or
                len(t['levels']) != 1 or len(t['levels'][0]) != 1):
            raise ValueError('Original single-plane Ray textures required')
        pixels = bytes.fromhex(levels[0][0])
        ref = t['levels'][0][0]
        if adapter.sha(pixels) != ref['sha256'] or len(pixels) != ref['bytes']:
            raise ValueError('Owned Ray texture payload differs')
        rgba = np.frombuffer(pixels, dtype=np.uint8).reshape(t['height'], t['width'], 4)
        handle = renderer.texture(rgba, 'clamp', 'nearest')
        sampler = material_device.sampler(bytes.fromhex(t['sampler']['descriptorHex']))
        textures[t['name']] = {'handle': handle, 'sampler': sampler['glHandle'], 'unit': t['unit']}
    used_units = {t['unit'] for t in textures.values()}
    for name, t in bound['sceneTextures'].items():
        pixels = bytes.fromhex(t['rgbaHex'])
        expected = 'ffffffff' if name == 'FOW_MAP_SharedTexture' else '00000000'
        if (name not in ['FOW_MAP_SharedTexture', 'PIXEL_COLOR_REMAP_RAMP_SharedTexture'] or
                t['width'] != 1 or t['height'] != 1 or t['rgbaHex'] != expected or
                adapter.sha(pixels) != t['resourcePolicy']['sourceSha256'] or
                t['inputPolicy'] != 'native-ray-allvision-remap-omitted-v1'):
            raise ValueError('Explicit original Ray scene texture policy required')
        unit = next(i for i in range(16) if i not in used_units)
        used_units.add(unit)
        sampler = material_device.sampler(bytes.fromhex(t['samplerDescriptorHex']))
        textures[name] = {'handle': renderer.texture(np.frombuffer(pixels, dtype=np.uint8).reshape(1, 1, 4), 'clamp', 'nearest'),
                          'sampler': sampler['glHandle'], 'unit': unit}
    if len({t['unit'] for t in textures.values()}) != len(textures):
        raise ValueError('Distinct native Ray sampler units required')
    return program, stages, pipeline, textures
