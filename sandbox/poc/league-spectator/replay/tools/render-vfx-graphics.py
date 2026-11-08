"""Visualize measured native activation boundaries, not rendered spell coverage."""
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
    raw=(cache/'research/vfx-graphics-native.json').read_bytes();observed=json.loads(raw)
    proof_raw=(cache/'research/vfx-graphics-inspection.json').read_bytes();proof=json.loads(proof_raw)
    if proof['observationSha256']!=sha(raw) or proof['mismatchCount']:
        raise ValueError('Native graphics observation differs from its inspection')
    categories=Counter()
    for case in observed['cases']:
        category=('parent-activated' if case['status']=='activated' else
            'render-pipeline' if case['pipelineRequests'] else
            'static-mesh-file' if case['fileRequests'] else 'other-dependency')
        categories[category]+=1
    labels=['Render-pipeline state', 'Static-mesh file provider', 'Other dependencies', 'Parent activation returned']
    keys=['render-pipeline','static-mesh-file','other-dependency','parent-activated']
    colors=['#5fb4f5','#e2b56c','#c58be5','#70c6a3']
    plt.rcParams.update({'font.family':'DejaVu Sans','text.color':'#e9eef7','axes.labelcolor':'#c5d0e0'})
    fig=plt.figure(figsize=(12.8,7.2),facecolor='#101822')
    fig.text(.06,.91,'One shared backend, 876 effect definitions',fontsize=23,weight='bold')
    fig.text(.06,.855,f"Build {observed['build']} · Original factory execution · Real offscreen GLES resources",fontsize=11,color='#a9bacf')
    ax=fig.add_axes([.30,.36,.59,.38],facecolor='#101822')
    for i,(label,key,color) in enumerate(zip(labels,keys,colors)):
        value=categories[key];ax.barh(i,value,color=color,height=.52)
        ax.text(value+12,i,f'{value:,}',va='center',fontsize=15,weight='bold')
    ax.set_yticks(range(len(labels)),labels,fontsize=12,color='#e9eef7');ax.invert_yaxis()
    ax.set_xlim(0,len(observed['cases']));ax.set_xticks([])
    ax.tick_params(axis='y',length=0,pad=12)
    for spine in ax.spines.values():spine.set_visible(False)
    counts=observed['counts']
    fig.text(.06,.24,f"{counts['compiledShaders']:,} shaders compiled  ·  {counts['linkedPrograms']:,} programs linked  ·  {counts['gpuSubresourcesVerified']:,} GPU subresources checked",fontsize=13,weight='bold')
    fig.text(.06,.17,'A boundary is recorded at the first unresolved dependency for each definition.',fontsize=11,color='#a9bacf')
    fig.text(.06,.125,'Parent activation alone does not establish visible emitters or correct playback.',fontsize=11,color='#a9bacf')
    fig.text(.06,.075,'Native component diagnostic. No browser or League execution. No additional rendered-spell coverage claimed.',fontsize=10,color='#91a4bd')
    destination=cache/'public/evidence/latest-vfx-graphics.png';destination.parent.mkdir(parents=True,exist_ok=True)
    fig.savefig(destination,dpi=140,facecolor=fig.get_facecolor());plt.close(fig)
    summary={'schema':1,'kind':'native-vfx-graphics-coverage','build':observed['build'],
        'protocol':observed['protocol'],'categories':dict(categories),'counts':counts,
        'observationSha256':sha(raw),'inspectionSha256':sha(proof_raw),
        'image':destination.name,'imageSha256':sha(destination.read_bytes()),
        'rendererSha256':sha(Path(__file__).read_bytes()),'scope':observed['scope']}
    (destination.with_suffix('.json')).write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(destination),'sha256':summary['imageSha256'],'categories':dict(categories)}))


if __name__=='__main__':main()
