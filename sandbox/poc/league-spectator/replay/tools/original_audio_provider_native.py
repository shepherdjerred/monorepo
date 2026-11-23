"""Original audio service-container registration, without device activation.

The original registration API creates the shared provider ownership and calls
the facade's full binding callback. No service pointer or callback return is
supplied by the harness; all lazy service factories execute original code.
"""
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import sha
from offscreen_application_native import original_offscreen_application
from original_sdk_memory_statics_native import initialize_original_sdk_memory_statics, original_module_initializer_identity


def initialize_original_audio_configuration(n, result):
    # 665f6d constructs compiled configuration before the application's UI
    # constructor. Its setters have an explicit null-UI branch. A partial UI
    # prefix cannot stand in for that later owner or alter the startup order.
    if n.q(n.base+0x246d010) or n.q(n.base+0x246d500):
        raise ValueError('Original configuration startup requires naturally cold UI and audio owners')
    archive_manager = n.q(n.base+0x246d7b0)
    if n.allocations.get(archive_manager) != 0x70 or not n.u32(archive_manager+0x50):
        raise ValueError('Original audio configuration requires genuinely registered signed archives')
    spans = [(0x27e930, 0x2847b0), (0x665f24, 0x665f89), (0x624060, 0x6241f0),
             (0x665bab, 0x665bc7), (0x62b42e, 0x62b443), (0x630f40, 0x63103f)]
    for start, end in spans:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original audio provider constructor/registration source differs')
    result['sources'] = [{'startRva': start, 'endRva': end, 'sha256': sha(n.image[start:end])}
                         for start, end in spans]
    # The original facade callback also binds its sibling services. Their
    # constructors consume strings and a synchronization owner from the same
    # registered static module. Execute its complete original function before
    # runtime configuration; do not patch the later mutex or string fields.
    if (n.u.mem_read(n.base+0x249c8b9, 1)[0] or
            any(n.q(n.base+offset) for offset in [0x249d240, 0x249d250, 0x249d260, 0x249d270])):
        raise ValueError('Original audio-dependent static module must be cold')
    result['originalStaticModule'] = original_module_initializer_identity(n, 0x27e930, 84)
    if (n.base+0x255cde0 in n.mutexes or n.base+0x255cde0 in n.character_mutexes or
            bytes(n.u.mem_read(n.base+0x255cde0, 64)) != bytes(n.source.image[0x255cde0:0x255ce20])):
        raise ValueError('Original audio static synchronization owner must be cold')
    n.call(0x27e930, {})
    if n.base+0x255cde0 not in n.mutexes or n.mutexes[n.base+0x255cde0]:
        raise ValueError('Complete original audio static module did not construct its mutex')
    result['originalStaticModule'].update(originalConstructorCompleted=True,
        originalMutexRva=0x255cde0, allApplicationInitializersExecuted=False)
    if getattr(n, 'darwin_sdk_threads', None) is not None:
        result['sdkMemoryModule'] = initialize_original_sdk_memory_statics(n, {})
    clock = n.q(n.base+0x246d000)
    if not clock:
        n.call(0x665bab, {}, end=0x665bc7)
        clock = n.q(n.base+0x246d000)
    if n.allocations.get(clock) != 0x60:
        raise ValueError('Original clock prerequisite owner differs')
    if n.q(n.base+0x2470e30):
        raise ValueError('Original frame-limiter owner must be cold')
    frame = n.allocate(0x1c0)
    n.u.mem_write(frame+0xc0, b'\xa5'*0x100)
    n.call(0x630f40, {r.UC_X86_REG_RDI: frame})
    limiter = n.q(frame+0xb8)
    if (n.q(n.base+0x2470e30) != frame or n.allocations.get(limiter) != 0x90 or
            bytes(n.u.mem_read(frame+0xc0, 0x100)) != b'\xa5'*0x100):
        raise ValueError('Original frame-limiter constructor publication/extent differs')
    result['originalFrameLimiterOwner'] = {'object': frame, 'limiter': limiter, 'constructorRva': 0x630f40,
        'allocationCaller': [0x62b42e, 0x62b443], 'frameSchedulerRegistered': False,
        'nativeLoopReadinessAdmitted': False}
    # The full compiled configuration constructor consults the original map
    # configuration's default mode field. Preserve an existing original owner;
    # otherwise execute its full constructor, without supplying that field.
    visibility = n.q(n.base+0x24705d0)
    if visibility:
        if not n.library_pointer(visibility, 0x1c0) or n.q(visibility) != n.base+0x2345608:
            raise ValueError('Existing original map configuration owner differs')
    else:
        visibility = n.allocate(0x2c0)
        n.u.mem_write(visibility+0x1c0, b'\xa5'*0x100)
        n.call(0x624060, {r.UC_X86_REG_RDI: visibility})
        if (n.q(n.base+0x24705d0) != visibility or
                bytes(n.u.mem_read(visibility+0x1c0, 0x100)) != b'\xa5'*0x100):
            raise ValueError('Original map configuration publication/extent differs')
    result['originalMapConfiguration'] = {'object': visibility, 'constructorRva': 0x624060,
        'recordedConfigurationAdmitted': False}
    # Full original compiled configuration constructor. This preserves its
    # authored defaults; it does not claim a recorded process/config override.
    if any(n.q(n.base+offset) for offset in [0x246d610, 0x246c490, 0x24712c8]):
        raise ValueError('Original compiled configuration, option and resource-group owners must be cold')
    # The immediately preceding original option-registry constructor is used
    # by configuration setters (d123f0 -> 36a080), so retain it in this prefix.
    result['offscreenPlatform'] = {}
    with original_offscreen_application(n, result['offscreenPlatform']):
        n.call(0x665f24, {}, end=0x665f89)
    flags = n.q(n.base+0x246d610)
    if n.allocations.get(flags) != 0xb8:
        raise ValueError('Original compiled configuration allocation differs')
    result['originalCompiledConfiguration'] = {'object': flags,
        'constructorRva': 0xd08790, 'caller': [0x665f24, 0x665f89],
        'recordedOverridesAdmitted': False}
    groups = n.q(n.base+0x24712c8)
    if n.allocations.get(groups) != 0x20 or not n.q(groups+0x18):
        raise ValueError('Original prerequisite resource-group ownership differs')
    result['resourceGroups'] = {'kind': 'original-source-ordered-resource-groups', 'object': groups,
        'imageSha256': sha(n.image), 'startupBlock': [0x665f24, 0x665f51],
        'sourceSha256': sha(n.image[0x665f24:0x665f51])}
    n.original_audio_configuration = flags


def initialize_original_audio_providers(n, result):
    flags = getattr(n, 'original_audio_configuration', None)
    if not flags or n.q(n.base+0x246d610) != flags or n.allocations.get(flags) != 0xb8:
        raise ValueError('Complete original configuration must precede original audio-facade construction')
    facade = n.q(n.base+0x246d500)
    if (n.allocations.get(facade) != 0x98 or n.q(facade+0x18) or n.q(facade+0x38) or
            n.q(n.q(facade+8)+0x10) != n.base+0x24c110):
        raise ValueError('Exact cold original audio facade/provider interface required')
    if getattr(n, 'darwin_sdk_threads', None) is not None and not getattr(n, 'original_sdk_memory_statics', False):
        raise ValueError('Original SDK memory static construction must precede runtime configuration')
    spans = [(0x62b3a0, 0x62b3b5), (0x142ffb0, 0x142ffdb),
             (0x66621b, 0x66623b), (0x6663bc, 0x6663f5),
             (0x24c110, 0x24c11e), (0x24bfe0, 0x24c0e9),
             (0x253050, 0x2530b9), (0x253120, 0x25323c)]
    for start, end in spans:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original audio provider constructor/registration source differs')
    container = n.allocate(0x138)
    n.u.mem_write(container+0x38, b'\xa5'*0x100)
    result.update(facade=facade, container=container, containerBytes=0x38,
                  sources=[{'startRva': start, 'endRva': end, 'sha256': sha(n.image[start:end])}
                           for start, end in spans],
                  originalContainerConstructorRva=0x142ffb0,
                  originalRegistrationCaller=[0x66621b, 0x66623b],
                  originalRegistrationRva=0x14304c0, originalFacadeCallbackRva=0x24bfe0,
                  scope={'applicationStartupCompleted': False, 'audioDeviceActivated': False,
                         'soundPlaybackVerified': False, 'recordedAudioSchedulingAdmitted': False})
    n.call(0x142ffb0, {r.UC_X86_REG_RDI: container})
    stop = n.base+0x66623b
    hook = n.u.hook_add(unicorn.UC_HOOK_CODE,
                        lambda engine, address, size, user: engine.emu_stop(), begin=stop, end=stop)
    try:
        n.call(0x66621b, {r.UC_X86_REG_R15: container, r.UC_X86_REG_R14: facade+8}, end=0x66623b)
        if n.u.reg_read(r.UC_X86_REG_RIP) != stop:
            raise ValueError('Original audio facade registration did not reach its exact boundary')
    finally:
        n.u.hook_del(hook)
    owner, service = n.q(facade+0x18), n.q(facade+0x38)
    if (not n.library_pointer(owner, 0x18) or n.q(owner+0x10) != container or
            n.allocations.get(service) != 0x200 or
            bytes(n.u.mem_read(container+0x38, 0x100)) != b'\xa5'*0x100):
        raise ValueError('Original audio provider shared ownership/service extent or guard differs')
    result.update(owner=owner, emitterService=service,
                  facadeServices=[{'offset': offset, 'object': n.q(facade+offset),
                                   'allocatedBytes': n.allocations.get(n.q(facade+offset))}
                                  for offset in [0x30, 0x38, 0x40, 0x48, 0x58, 0x60]],
                  originalProviderRegistrationCompleted=True)
