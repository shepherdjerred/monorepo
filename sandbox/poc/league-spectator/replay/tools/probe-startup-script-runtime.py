"""Run the original VM constructor while retaining recorded startup settings."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from legacy_effect_native import NativeLegacyEffectInputs
from startup_map_skin_native import recover_startup_map_skin
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:p.add_argument(name,type=Path)
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeLegacyEffectInputs)
    n = fixture.native
    fixture.raw(fixture.cache/'research/darwin-errlst.c')
    startup,vm,boundary = None,None,None
    settings = None
    try:
        startup = recover_startup_map_skin(n,fixture.cache,fixture.root,fixture.read,fixture.raw)
        settings = n.q(n.base+0x246d620)
        vm = n.initialize_character_script_vm()
        if not settings or not vm['existingSettingsReused'] or vm['settings'] != settings or n.q(n.base+0x246d620) != settings:
            raise ValueError('Original startup settings were not retained by VM construction')
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(recover_startup_map_skin)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-startup-script-settings-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'inputs':fixture.inputs,
              'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},'originalBlocks':list(n.blocks.values()),
              'startup':startup,'settingsBeforeVm':settings,'vm':vm,'boundary':boundary,
              'scope':{'originalVmConstructorCompleted':vm is not None and boundary is None,
                       'fullStartupHandlerExecuted':False,'gameBindingsRegistered':False,'mainViewerExpanded':False}}
    output = fixture.cache/'research/startup-script-runtime-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'vm':vm,'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()
