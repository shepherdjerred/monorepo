"""Observe the original installed champion catalog without a game process."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from legacy_effect_native import NativeLegacyEffectInputs
from installed_resource_archive_native import register_resource_archive
from champion_catalog_native import initialize_binary_resource_cache,initialize_binary_postload_tls,initialize_champion_catalog
from vfx_spawn_native import sha
from vfx_object_native import NativeVfxObjects
from aligned_asset_memory_native import AlignedAssetMemory


class NativeCatalogMemory(AlignedAssetMemory,NativeLegacyEffectInputs):pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','installation']:parser.add_argument(name,type=Path)
    args=parser.parse_args()
    fixture=NativeAIUnitFixture(args.cache,args.client,NativeCatalogMemory);n=fixture.native
    fixture.raw(fixture.cache/'research/darwin-errlst.c')
    catalog,archive,boundary,binary_cache,vm,type_count,postload_tls=None,None,None,None,None,None,None
    try:
        type_count=n.initialize_character_types()
        archive=register_resource_archive(fixture,args.installation,'Global.wad.client')
        vm=n.initialize_character_script_vm()
        binary_cache=initialize_binary_resource_cache(n)
        postload_tls=initialize_binary_postload_tls(n)
        catalog=initialize_champion_catalog(n)
        if any(n.q(row['cell'])!=row['initialValue'] for row in postload_tls['variables']):
            raise ValueError('Original catalog constructor did not restore its post-load thread variables')
    except Exception as error:
        boundary={'kind':type(error).__name__,'message':str(error),
                  'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                  'registers':{name:n.u.reg_read(getattr(r,'UC_X86_REG_'+name.upper())) for name in ['rax','rbx','rdi','rsi','rdx','rcx','r8','r9','rbp','rsp']}}
        stack=n.u.reg_read(r.UC_X86_REG_RSP)
        if n.library_pointer(stack,128):boundary.update(stackHex=bytes(n.u.mem_read(stack,128)).hex(),returnRva=n.q(stack)-n.base)
    finally:n.close_files()
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(NativeVfxObjects)),
           Path(inspect.getfile(register_resource_archive)),Path(inspect.getfile(initialize_champion_catalog)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result={'schema':1,'kind':'original-installed-champion-catalog-observations',
            'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
            'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
            'originalBlocks':list(n.blocks.values()),'installedArchive':archive,'catalog':catalog,
            'binaryResourceCache':binary_cache,'scriptVm':vm,'platformCalls':n.object_os_calls,
            'reflectionTypeCount':type_count,'alignedMemoryCalls':n.asset_aligned_calls,
            'postloadThreadVariables':postload_tls,
            'catalogPrefix':getattr(n,'champion_catalog_observation',None),
            'boundary':boundary,'fileRequests':n.file_requests,'fileCalls':n.file_calls,'fileLookups':n.file_lookups,
            'scope':{'originalCatalogConstructorCompleted':catalog is not None,'worldBindingsVerified':False,
                     'mainViewerExpanded':False}}
    output=fixture.cache/'research/champion-catalog-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'entries':catalog['entryCount'] if catalog else None,'boundary':boundary}),flush=True)


if __name__=='__main__':main()
