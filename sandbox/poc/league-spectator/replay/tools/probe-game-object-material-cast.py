"""Original GameObject runtime registration and material owner-interface casts.

Only exact original static LEA/CALL pairs initialize the missing descriptors.
No substitute vtable, descriptor ancestry or callback return is installed.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from character_graph_snapshot import restore
from native_ai_unit_fixture import NativeAIUnitFixture
from ai_hero_stack_native import NativeHeroStackProbe
from ai_hero_type_native import initialize_hero_client_types, verify_hero_client_cast
from character_script_native import NativeCharacterScripts
from libcpp_shared_native import NativeLibcppSharedOwnership
from mode_dependency_types_native import initialize_mode_dependency_types
from process_arguments_native import initialize_product_configuration
from game_object_type_native import initialize_game_object_runtime_types
from ai_material_owner_type_native import initialize_ai_material_owner_type
from vfx_spawn_native import sha, ADDRESSES


class Control(NativeHeroStackProbe, NativeLibcppSharedOwnership, NativeCharacterScripts):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    reference = fixture.read(fixture.cache / 'research/character-asset-postload-champions-viego-43-types-23ea1915-45cd899f-9b67e9f6-ef3a0f33-f5fb07c7-native.json')
    for path, expected in reference['inputs'].items():
        if sha(fixture.raw(Path(path))) != expected:
            raise ValueError('Original character snapshot input changed: ' + path)
    for name, expected in reference['sources'].items():
        if sha(fixture.raw(fixture.root / 'tools' / name)) != expected:
            raise ValueError('Original character snapshot producer changed: ' + name)
    restore(fixture, reference['snapshot'])
    interface = n.base + 0x2531558
    owner = n.base + 0x24bddb0
    concrete = n.base + 0x24bdcd8
    required = n.base + 0x25464d0
    if (n.u32(interface + 8) != 0xa4f28691 or n.u32(required + 8) != 0xa4795108 or
            n.u32(owner + 8) or n.u32(concrete + 8)):
        raise ValueError('Expected initialized interfaces and cold GameObject runtime descriptors')
    obj = n.allocate(0x168)
    n.call(0x5481e0, {r.UC_X86_REG_RDI: obj})
    interface_object = obj + 8
    dynamic_getter = n.q(n.q(interface_object)) - n.base
    n.call(dynamic_getter, {r.UC_X86_REG_RDI: interface_object})
    if n.u.reg_read(r.UC_X86_REG_RAX) != concrete:
        raise ValueError('Original GameObject interface dynamic descriptor differs')

    def checked():
        n.call(0x14b6400, {r.UC_X86_REG_RDI: interface, r.UC_X86_REG_RSI: interface_object,
                          r.UC_X86_REG_RDX: concrete})
        return n.u.reg_read(r.UC_X86_REG_RAX)

    cold = checked()
    if cold:
        raise ValueError('Cold runtime descriptors unexpectedly permit owner-interface cast')
    # Both original startup LEA/CALL pairs, preserving original order.
    registration = initialize_game_object_runtime_types(n)
    if (n.u32(concrete + 8) != 0x1fac8b64 or n.q(concrete + 0x38) != owner or
            n.u32(owner + 8) != 0xb2305647 or n.u32(owner + 0x70) != 1 or
            n.q(n.q(owner + 0x68)) != interface or n.u32(n.q(owner + 0x68) + 8) != 8):
        raise ValueError('Original runtime parent/interface publication differs')
    ready = checked()
    if ready != obj:
        raise ValueError('Original registered interface cast did not recover its GameObject')
    n.call(0x14b6410, {r.UC_X86_REG_RDI: interface, r.UC_X86_REG_RSI: interface_object,
                      r.UC_X86_REG_RDX: required})
    callback_result = n.u.reg_read(r.UC_X86_REG_RAX)
    if callback_result != obj + 0x18:
        raise ValueError('Original GameObject material interface differs from its registered offset')
    leaf_inputs = dict(fixture.inputs)
    # A fresh original snapshot keeps the full mode module's own descriptor
    # registrations independent of the preceding focused GameObject control.
    hero_fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    restore(hero_fixture, reference['snapshot'])
    n = hero_fixture.native
    setup = {'audio': n.initialize_audio_facade(), 'ui': n.initialize_ui_data_prefix(),
             'product': initialize_product_configuration(n, 'LoL'),
             'modeTypes': initialize_mode_dependency_types(n),
             'heroTypes': initialize_hero_client_types(n, reuse_existing=True)}
    unit = n.allocate(0x4aa0)
    n.u.mem_write(unit + 0x49a0, b'\xa5' * 0x100)
    n.call(0x154c10, {r.UC_X86_REG_RDI: unit})
    setup['heroClientCast'] = verify_hero_client_cast(n, unit)
    if n.u32(concrete + 8) != 0x1fac8b64 or n.u32(owner + 8) != 0xb2305647:
        raise ValueError('Original full mode module did not register GameObject descriptors')
    n.call(0x14b6400, {r.UC_X86_REG_RDI: interface, r.UC_X86_REG_RSI: unit + 8,
                      r.UC_X86_REG_RDX: concrete})
    hero_before = n.u.reg_read(r.UC_X86_REG_RAX)
    if hero_before:
        raise ValueError('Cold AI parent metadata unexpectedly completes the full Hero owner cast')
    parent_blocks = [(0x13774f,0x1377b4,0x248e550,0x2092043f),
                     (0xdb497,0xdb4fc,0x248d700,0x5c93a47b)]
    parent_operations = []
    for start, end, descriptor, identity in parent_blocks:
        existing = n.u32(n.base + descriptor + 8)
        if existing and existing != identity:
            raise ValueError('Existing AI parent descriptor identity differs')
        if not existing:
            if descriptor != 0x248d700:
                raise ValueError('Actual original mode setup must register the first AI parent')
            setup['materialOwnerAncestor'] = initialize_ai_material_owner_type(n)
        parent_operations.append({'descriptorRva':descriptor,'identity':identity,
                                  'alreadyRegisteredBySetup':bool(existing),
                                  'originalBlock':[start,end]})
        if n.u32(n.base + descriptor + 8) != identity:
            raise ValueError('Original AI parent descriptor identity differs')
    n.call(0x14b6400, {r.UC_X86_REG_RDI: interface, r.UC_X86_REG_RSI: unit + 8,
                      r.UC_X86_REG_RDX: concrete})
    if n.u.reg_read(r.UC_X86_REG_RAX) != unit:
        raise ValueError('Original full Hero parent-chain cast did not recover its root')
    n.call(0x14b6410, {r.UC_X86_REG_RDI: interface, r.UC_X86_REG_RSI: unit + 8,
                      r.UC_X86_REG_RDX: required})
    hero_result = n.u.reg_read(r.UC_X86_REG_RAX)
    if hero_result != unit + 0x18:
        raise ValueError('Original concrete Hero material-interface parent chain differs')
    callback = n.q(n.q(hero_result) + 0x18) - n.base
    if callback != 0x549b60:
        raise ValueError('Original Hero material predicate callback differs')
    n.call(callback, {r.UC_X86_REG_RDI: hero_result})
    callback_bool = n.u.reg_read(r.UC_X86_REG_RAX) & 255
    if callback_bool != 0 or bytes(n.u.mem_read(unit + 0x49a0, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Original cold Hero predicate or guard differs')
    ranges = [(0x557896,0x5578a2),(0x557934,0x557940),(0x5480a0,0x5481c7),
              (0x54cce0,0x54cdf7),(0x551c90,0x551cad),(0x14b6410,0x14b647e),
              (0x17b8d30,0x17b8d65),(0x14be0c0,0x14be0e5),(0x549b60,0x549c60),
              *[(a,b) for a,b,_,_ in parent_blocks]]
    for start, end in ranges:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original cast/registration instruction image differs')
    paths = {Path(__file__), Path(inspect.getfile(restore)), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(fn)) for fn in [initialize_game_object_runtime_types,
                 initialize_hero_client_types, verify_hero_client_cast,
                 initialize_product_configuration, initialize_mode_dependency_types,
                 initialize_ai_material_owner_type]],
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    result = {'schema':1,'kind':'original-game-object-material-cast-prerequisite-control',
              'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
              'decoderImageSha256':sha(n.image),'inputs':{**leaf_inputs,**hero_fixture.inputs},'sources':sources,
              'object':obj,'interfaceObject':interface_object,'dynamicGetterRva':dynamic_getter,
              'checkedCastBeforeRuntimeRegistration':cold,'checkedCastAfterRuntimeRegistration':ready,
              'originalMaterialInterfaceResult':callback_result,
              'registration':registration,'heroSetup':setup,
              'coldHeroControl':{'unit':unit,'materialInterface':hero_result,'callbackRva':callback,
                                  'predicate':callback_bool,'originalConstructorRva':0x154c10,
                                  'checkedOwnerCastBeforeAiParents':hero_before,
                                  'aiParentOriginalBlocks':parent_blocks,
                                  'aiParentOperations':parent_operations,
                                  'gameObjectDescriptorsAlreadyRegisteredByMode':True,
                                  'originalMaterialCastCompleted':True},
              'runtimeDescriptors':[{'rva':at-n.base,'hash':n.u32(at+8),
                                     'parent':n.q(at+0x38),'bytesHex':bytes(n.u.mem_read(at,0x80)).hex()}
                                    for at in [concrete,owner]],
              'sourceBlocks':[{'rva':a,'size':b-a,'sha256':sha(n.image[a:b])} for a,b in ranges],
              'scope':{'originalObjectConstructor':True,'originalRuntimeRegistration':True,
                       'originalCheckedAndUncheckedInterfaceCasts':True,'descriptorOrVtableSubstitutions':False,
                       'fullHeroComponentProducerExecuted':False,'actualReplayEntityAccepted':False,
                       'materialParameterEvaluationEstablished':False,'browserExecuted':False}}
    for path, expected in {**result['inputs'], **sources}.items():
        if sha(Path(path).read_bytes()) != expected:
            raise ValueError('Input drift: ' + path)
    output=fixture.cache/'research/game-object-material-cast-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'coldCast':cold,'registeredCast':ready,
                      'materialInterface':callback_result,'coldHeroInterface':hero_result,
                      'coldHeroPredicate':callback_bool}))


if __name__=='__main__':
    main()
