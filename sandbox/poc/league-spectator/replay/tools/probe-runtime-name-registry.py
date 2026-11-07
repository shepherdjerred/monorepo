"""Observe original cold startup construction of the named-record registry."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from asset_work_queue_native import NativeAssetWorkQueue
from libc_ascii_compare_native import NativeAsciiCaseCompare
from runtime_name_registry_native import initialize_runtime_name_registry,inspect_runtime_name_registry
from vfx_spawn_native import sha


class NativeRegistryInputs(NativeAsciiCaseCompare,NativeAssetWorkQueue):pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path)
    parser.add_argument('--register-control-records',action='store_true',help='Register explicit control names through original code; not replay records')
    args=parser.parse_args()
    fixture=NativeAIUnitFixture(args.cache,args.client,NativeRegistryInputs);n=fixture.native
    result={'schema':1,'kind':'original-runtime-name-registry','build':n.profile['clientVersion'],
            'initialization':None,'registry':None,'boundary':None}
    try:
        result['initialization']=initialize_runtime_name_registry(n)
        if args.register_control_records:
            for name in ['Probe_One','probe_one','Probe_Two']:
                record=n.allocate(0x20)
                n.call(0x14c2d60,{r.UC_X86_REG_RDI:record+0x10,r.UC_X86_REG_RSI:n.allocate_text(name)})
                n.call(0x83be00,{r.UC_X86_REG_RDI:result['initialization']['object'],r.UC_X86_REG_RSI:record})
        result['registry']=inspect_runtime_name_registry(n,result['initialization'])
        if args.register_control_records and (result['registry']['namedCount']!=2 or result['registry']['hashedCount']!=2 or
                not n.ascii_case_compare_calls):raise ValueError('Original case-insensitive registration did not merge the case variant')
    except Exception as error:
        result['boundary']={'kind':type(error).__name__,'message':str(error),
                            'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    finally:n.close_files()
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
           Path(inspect.getfile(initialize_runtime_name_registry)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result.update(inputs=fixture.inputs,sources={p.name:sha(p.read_bytes()) for p in sorted(paths)},
                  decoderImageSha256=sha(n.image),originalBlocks=list(n.blocks.values()),
                  asciiCaseCompareCalls=n.ascii_case_compare_calls,
                  scope={'recordRegistrationExercised':args.register_control_records,'suppliedControlNames':args.register_control_records,'mainViewerExpanded':False})
    output=fixture.cache/'research'/('runtime-name-registry-registration-native.json' if args.register_control_records else 'runtime-name-registry-native.json')
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'registry':result['registry'],'boundary':result['boundary']}))


if __name__=='__main__':main()
