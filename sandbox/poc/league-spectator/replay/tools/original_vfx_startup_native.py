"""Original VFX startup dependencies shared by isolated native controls."""
import struct
from original_call_slices_native import call_original_sliced
from vfx_graphics_native import DEVICE
from vfx_spawn_native import sha


def initialize_original_vfx_startup(n, fixture, graphics, source, setup, execution, *, resource_groups=None):
    if (source['kind'] != 'original-vfx-manager-startup-source' or source['startupEntryRva'] != 0x36fd40 or
            source['decoderImageSha256'] != sha(n.image)):
        raise ValueError('Exact original scene/VFX startup source required')
    for block in source['sourceBlocks']:
        start, end = block['startRva'], block['endRva']
        if n.image[start:end] != n.source.image[start:end] or sha(n.image[start:end]) != block['sha256']:
            raise ValueError('Original scene/VFX startup source bytes differ')
    setup['phase'] = 'original-clock-and-pause-owners'
    for name, entry, end, global_, size in [('clockService', 0x665bab, 0x665bc7, 0x246d000, 0x60),
                                           ('pauseOwner', 0x66d6c0, None, 0x2472360, 0x140)]:
        owner = n.q(n.base+global_)
        reused = bool(owner)
        if not owner:
            n.call(entry, {}, end=end)
            owner = n.q(n.base+global_)
        if n.allocations.get(owner) != size:
            raise ValueError('Original clock/pause owner identity differs')
        setup[name] = {'object': owner, 'entryRva': entry, 'endRva': end, 'existingOwnerReused': reused}
    setup['phase'] = 'original-resource-group-startup'
    start, end = 0x665f24, 0x665f51
    if n.image[start:end] != n.source.image[start:end]:
        raise ValueError('Original resource-group startup source differs')
    if resource_groups is None:
        if n.q(n.base+0x24712c8):
            raise ValueError('Original cold resource-group startup identity differs')
        n.call(start, {}, end=end)
    elif (resource_groups['kind'] != 'original-source-ordered-resource-groups' or
            resource_groups['imageSha256'] != sha(n.image) or resource_groups['startupBlock'] != [start, end] or
            resource_groups['sourceSha256'] != sha(n.image[start:end]) or
            resource_groups['object'] != n.q(n.base+0x24712c8)):
        raise ValueError('Explicit source-ordered resource-group owner receipt differs')
    groups = n.q(n.base+0x24712c8)
    if n.allocations.get(groups) != 0x20 or not n.q(groups+0x18):
        raise ValueError('Original resource-group startup did not publish its owned object')
    setup['resourceGroups'] = {'object': groups, 'startupBlock': [start, end], 'sourceSha256': sha(n.image[start:end]),
                               'explicitSourceOrderedOwnerRetained': resource_groups is not None}
    setup['phase'] = 'original-render-resource-registry'
    start, end = 0x180ce50, 0x180ce78
    if n.image[start:end] != n.source.image[start:end] or n.q(n.base+0x256dec0):
        raise ValueError('Original cold render resource-registry startup identity differs')
    n.call(start, {})
    renderer = n.q(n.base+0x256dec0)
    if n.allocations.get(renderer) != 0x180:
        raise ValueError('Original render resource registry did not publish its owned object')
    setup['renderResourceRegistry'] = {'object': renderer, 'startupRva': start,
                                       'sourceSha256': sha(n.image[start:end]), 'fullRendererInitialization': False}
    setup['phase'] = 'original-material-cache-startup'
    start, end = 0x180d41b, 0x180d437
    if n.image[start:end] != n.source.image[start:end] or n.q(n.base+0x247c9c0):
        raise ValueError('Original cold material-cache startup identity differs')
    n.call(start, {}, end=end)
    materials = n.q(n.base+0x247c9c0)
    if n.allocations.get(materials) != 0x90:
        raise ValueError('Original material-cache startup did not publish its owned object')
    setup['materialCache'] = {'object': materials, 'startupBlock': [start, end], 'sourceSha256': sha(n.image[start:end])}
    if graphics is not None:
        setup['phase'] = 'original-graphics-resource-constructors'
        for name in ['libEGL.dll', 'libGLESv2.dll']:
            fixture.raw(graphics/name)
        setup['graphics'] = n.initialize_character_graphics(graphics)
        if not setup['graphics'].get('originalCpuDeviceBaseConstructorCompleted'):
            raise ValueError('Complete original CPU device-base owner required')
        setup['originalCpuDeviceVirtuals'] = []
        for offset, expected in [(0x278, 0x1914dc0), (0x270, 0x1914030), (0x28, 0x1922dc0)]:
            original = struct.unpack_from('<Q', n.image, 0x2408570+offset)[0]
            if original != n.base+expected or n.image[expected:expected+16] != n.source.image[expected:expected+16]:
                raise ValueError('Exact original CPU device virtual identity differs')
            n.put(n.q(DEVICE)+offset, 'Q', original)
            setup['originalCpuDeviceVirtuals'].append({'slot': offset, 'originalRva': expected,
                'scope': 'Original CPU resource lookup/capability descriptor; no named resource or Metal execution supplied'})
    setup['phase'] = 'complete-original-scene-and-vfx-startup'
    scene_global, manager_global = 38437792, 38199248
    if n.q(n.base+scene_global) or n.q(n.base+manager_global):
        raise ValueError('Original scene/VFX owner globals must be cold')
    call_original_sliced(n, source['startupEntryRva'], {}, execution)
    scene, manager = n.q(n.base+scene_global), n.q(n.base+manager_global)
    if (n.allocations.get(scene) != source['sceneOwner']['allocationBytes'] or
            n.allocations.get(manager) != source['manager']['allocationBytes'] or
            n.q(manager+8) != scene or n.q(manager+0x10) != scene):
        raise ValueError('Original allocated scene/manager ownership or constructor argument differs')
    setup['owners'] = {'scene': scene, 'manager': manager, 'sceneBytes': source['sceneOwner']['allocationBytes'],
                       'managerBytes': source['manager']['allocationBytes'],
                       'sceneHex': bytes(n.u.mem_read(scene, source['sceneOwner']['allocationBytes'])).hex(),
                       'managerHex': bytes(n.u.mem_read(manager, source['manager']['allocationBytes'])).hex(),
                       'navmaskTexture': n.q(manager+0x2d8), 'particleInstanceInfo': n.q(manager+0x2e0)}
    setup['phase'] = 'complete'
    return setup
