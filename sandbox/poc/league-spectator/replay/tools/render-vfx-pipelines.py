"""Render measured native activation progress without claiming replay pixels."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def sha(data):return hashlib.sha256(data).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('cache',type=Path)
    args=parser.parse_args();cache=args.cache.resolve()
    source=(cache/'research/vfx-pipelines-native.json').read_bytes();data=json.loads(source)
    proof_bytes=(cache/'research/vfx-pipelines-inspection.json').read_bytes();proof=json.loads(proof_bytes)
    contracts_bytes=(cache/'research/vfx-pipeline-contracts.json').read_bytes();contracts=json.loads(contracts_bytes)
    if (proof['observationSha256']!=sha(source) or proof['mismatchCount'] or
            proof['nativeContractsSha256']!=sha(contracts_bytes) or contracts['observationSha256']!=sha(source)):
        raise ValueError('Native pipeline observations or comparison changed')
    categories=Counter()
    populated=0
    for case in data['cases']:
        category=('parent-activated' if case['status']=='activated' else 'file-provider' if case['fileRequests'] else 'other-dependency')
        categories[category]+=1
        populated+=bool(case['status']=='activated' and case.get('actors'))
    plt.rcParams.update({'font.family':'DejaVu Sans','text.color':'#e9eef7'})
    fig=plt.figure(figsize=(12.8,7.8),facecolor='#101822')
    fig.text(.055,.92,'Shared pipeline bridge: native activation',fontsize=23,weight='bold')
    fig.text(.055,.865,f"Build {data['build']} · All {len(data['cases'])} prepared definitions · Explicit seed 12345 and supplied clock",fontsize=11,color='#a9bacf')
    ax=fig.add_axes([.30,.41,.60,.34],facecolor='#101822')
    labels=['Parent activation returned','File/resource provider','Other explicit dependencies']
    keys=['parent-activated','file-provider','other-dependency'];colors=['#70c6a3','#e2b56c','#c58be5']
    for i,(key,color) in enumerate(zip(keys,colors)):
        value=categories[key];ax.barh(i,value,color=color,height=.5)
        ax.text(value+12,i,f'{value:,}',va='center',fontsize=16,weight='bold')
    ax.set_yticks(range(3),labels,fontsize=12,color='#e9eef7');ax.invert_yaxis()
    ax.set_xlim(0,len(data['cases']));ax.set_xticks([]);ax.tick_params(axis='y',length=0,pad=12)
    for spine in ax.spines.values():spine.set_visible(False)
    counts=data['counts'];native_counts=contracts['counts']
    fig.text(.055,.30,f"{populated:,} definitions created actors  ·  {counts['createdActors']:,} actor instances  ·  {counts['createdPipelines']:,} pipeline states",fontsize=13,weight='bold')
    fig.text(.055,.235,f"Native comparison: {native_counts['uniquePipelineDescriptors']:,} state variants, {native_counts['uniqueUniformCopies']:,} distinct uniform copies, {native_counts['uniqueSamplerDescriptors']} sampler variants",fontsize=11,color='#a9bacf')
    fig.text(.055,.185,f"GPU readback: {counts['uniformBuffersVerified']:,} material buffers and {counts['gpuSubresourcesVerified']:,} texture subresources. Zero comparison mismatches.",fontsize=11,color='#a9bacf')
    fig.text(.055,.115,'Activation and actor construction do not establish correct simulation or visible effect playback.',fontsize=11,color='#e2b56c')
    fig.text(.055,.065,'Native/offscreen only. Scene globals, complete resources and WASM/main-viewer integration remain open.',fontsize=10,color='#91a4bd')
    destination=cache/'public/evidence/latest-vfx-pipelines.png';destination.parent.mkdir(parents=True,exist_ok=True)
    fig.savefig(destination,dpi=140,facecolor=fig.get_facecolor());plt.close(fig)
    summary={'schema':1,'kind':'native-vfx-pipeline-coverage','build':data['build'],'protocol':data['protocol'],
        'categories':dict(categories),'populatedDefinitionsWithActors':populated,'counts':counts,
        'nativeContractCounts':native_counts,'observationSha256':sha(source),'inspectionSha256':sha(proof_bytes),
        'nativeContractsSha256':sha(contracts_bytes),'image':destination.name,'imageSha256':sha(destination.read_bytes()),
        'rendererSha256':sha(Path(__file__).read_bytes()),'scope':data['scope']}
    destination.with_suffix('.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(destination),'sha256':summary['imageSha256'],'categories':dict(categories),
        'populatedDefinitionsWithActors':populated}))


if __name__=='__main__':main()
