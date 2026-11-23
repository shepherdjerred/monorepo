"""Original AIHeroClient construction and animation-owner RTTI controls.

These are cold owned clients. Recorded world registration, character appearance,
live attribute providers and the game frame scheduler are not supplied.
"""
import unicorn
from pathlib import Path
from unicorn import x86_const as r
from ai_hero_stack_native import NativeHeroStackProbe
from ai_hero_type_native import initialize_hero_client_types, verify_hero_client_cast
from ai_material_owner_type_native import initialize_ai_material_owner_type
from character_graph_snapshot import restore
from character_script_native import NativeCharacterScripts
from libcpp_shared_native import NativeLibcppSharedOwnership
from mode_dependency_types_native import initialize_mode_dependency_types
from native_ai_unit_fixture import NativeAIUnitFixture
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import sha


class NativeAnimationProvider(NativeHeroStackProbe, NativeLibcppSharedOwnership, NativeCharacterScripts):
    pass


def bounded_prefix(n, start, end):
    # Unicorn's until address can sit inside a translated block. Observe the
    # exact instruction boundary, including when its caller was translated.
    hook = n.u.hook_add(unicorn.UC_HOOK_CODE,
                        lambda engine, address, size, user: engine.emu_stop(),
                        begin=n.base+end, end=n.base+end)
    try:
        n.call(start, {}, end)
    finally:
        n.u.hook_del(hook)


def create_animation_provider_fixture(cache, client, snapshot_bindings=None):
    fixture = NativeAIUnitFixture(cache, client, NativeAnimationProvider)
    n = fixture.native
    reference = fixture.read(fixture.cache/'research/character-asset-postload-champions-viego-43-types-23ea1915-45cd899f-9b67e9f6-ef3a0f33-f5fb07c7-native.json')
    if snapshot_bindings is not None and set(snapshot_bindings) != set(reference['inputs']):
        raise ValueError('Complete explicit historical snapshot input bindings required')
    for file, digest in reference['inputs'].items():
        selected = snapshot_bindings[file] if snapshot_bindings is not None else file
        if sha(fixture.raw(Path(selected))) != digest:
            raise ValueError('Original provider snapshot input changed: '+file)
    for name, digest in reference['sources'].items():
        if sha(fixture.raw(fixture.root/'tools'/name)) != digest:
            raise ValueError('Original provider snapshot producer changed: '+name)
    restore(fixture, reference['snapshot'])
    bounded_prefix(n, 0x14aa3bf, 0x14aa5f9)
    fixture.animation_provider_setup = {
        'audio': n.initialize_audio_facade(), 'ui': n.initialize_ui_data_prefix(),
        'product': initialize_product_configuration(n, 'LoL'),
        'modeTypes': initialize_mode_dependency_types(n),
        'heroTypes': initialize_hero_client_types(n, reuse_existing=True),
        'ownerAncestor': initialize_ai_material_owner_type(n),
    }
    return fixture


def construct_animation_hero(fixture):
    n = fixture.native
    size = n.q(n.base+0x24913e0+0x40)
    if size != 0x49a0:
        raise ValueError('Original concrete AIHeroClient extent differs')
    unit = n.allocate(size+0x100)
    n.u.mem_write(unit+size, b'\xa5'*0x100)
    n.call(0x154c10, {r.UC_X86_REG_RDI: unit})
    verify_hero_client_cast(n, unit)
    if bytes(n.u.mem_read(unit+size, 0x100)) != b'\xa5'*0x100:
        raise ValueError('Original complete hero constructor/extent differs')
    n.call(0x160c000, {})
    n.call(0x14b6400, {r.UC_X86_REG_RDI: n.u.reg_read(r.UC_X86_REG_RAX),
                     r.UC_X86_REG_RSI: unit+8, r.UC_X86_REG_RDX: n.base+0x248e608})
    if n.u.reg_read(r.UC_X86_REG_RAX) != unit:
        raise ValueError('Original animation-owner RTTI did not return hero base')
    return unit
