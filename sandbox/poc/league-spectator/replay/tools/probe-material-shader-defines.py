"""Compare bounded raw material macros with the unchanged pinned Rust selector."""
import argparse
import json
import subprocess
from pathlib import Path
from material_shader_defines_native import declared_macro_indices, MATERIAL_RAW_MACRO_BUDGET
from shader_permutation import select_permutation
from vfx_spawn_native import sha


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path);p.add_argument('package',type=Path)
    args=p.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        b=path.read_bytes();inputs[str(path.resolve())]=sha(b);return b
    reference=json.loads(raw(cache/'research/shader-selector-comparison.json'))
    for path,digest in reference['inputs'].items():
        if sha(raw(Path(path)))!=digest:raise ValueError('Original selector input changed: '+path)
    manifest=json.loads(raw(args.package/'package.json'))
    stages=[s for s in manifest['stages'] if s['file'].endswith('/alphablend_additive_scroll_packed.vs')]
    if len(stages)!=1:raise ValueError('Observed expanded-macro shader stage required')
    stage=stages[0]
    candidates=list((cache/'research').glob('*/'+stage['tocSha256']+'.toc'))
    if not candidates or sha(raw(candidates[0]))!=stage['tocSha256']:raise ValueError('Original shader TOC required')
    declared=stage['baseDefines'][0]
    known={'name':declared['name'],'value':declared['value']}
    cases=[];expected=[]
    for count in [33,36,37,64,MATERIAL_RAW_MACRO_BUDGET]:
        defines=[{'name':'UNDECLARED_CONTROL_'+str(i),'value':'1'} for i in range(count-1)]+[known]
        indices=declared_macro_indices(stage,defines)
        if indices!=[count-1]:raise ValueError('Last declared raw macro was lost')
        expected.append(select_permutation(stage,[defines[i] for i in indices])['id'])
        cases.append({'id':count,'defines':defines})
    work=cache/'research/material-shader-defines-requests.json'
    work.write_text(json.dumps(cases),encoding='utf-8');raw(work)
    executable=cache/'research/shader-selector-comparison/reference.exe'
    result=subprocess.run([str(executable),str(candidates[0]),str(work)],check=True,capture_output=True,text=True,timeout=30)
    observed=json.loads(result.stdout)
    if [row['selectedRecordId'] for row in observed]!=expected:raise ValueError('Expanded material macros differ from pinned Rust selector')
    rejected=0
    for defines in [cases[-1]['defines']+[{'name':'EXTRA','value':'1'}],
                    [*cases[0]['defines'][:-1],cases[0]['defines'][0]],
                    [*cases[0]['defines'][:-1],{'name':'','value':'1'}]]:
        try:declared_macro_indices(stage,defines)
        except ValueError:rejected+=1
        else:raise ValueError('Invalid expanded material macros admitted')
    for name in ['probe-material-shader-defines.py','material_shader_defines_native.py','shader_permutation.py']:
        raw(Path(__file__).with_name(name))
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Input drift: '+path)
    report={'schema':1,'kind':'expanded-static-material-macro-selector-control','inputs':inputs,
            'controls':len(cases),'rejected':rejected,'differences':0,
            'scope':{'pinnedUnchangedRustReference':True,'rawMacroCounts':[33,36,37,64,MATERIAL_RAW_MACRO_BUDGET],
                     'platformRawMacroBudget':MATERIAL_RAW_MACRO_BUDGET,'nativeMaximumMacroCountRecovered':False,
                     'existingVfxLimitUnchanged':True,'originalMaterialRequestExecuted':False,'gpuCompiled':False}}
    out=cache/'research/material-shader-defines-comparison.json';out.write_text(json.dumps(report,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(out),'controls':len(cases),'rejected':rejected,'differences':0}))


if __name__=='__main__':main()
