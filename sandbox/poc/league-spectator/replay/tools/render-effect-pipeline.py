"""Visualize broad recorded effect requests and shared capability gaps."""
import argparse,json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from vfx_spawn_native import sha


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','output']:p.add_argument(name,type=Path)
    a=p.parse_args();cache=a.cache.resolve();root=Path(__file__).parent.parent
    path=cache/'research/effect-pipeline-comparison.json';raw=path.read_bytes();proof=json.loads(raw)
    for name,h in proof['sources'].items():
        if sha((root/name).read_bytes())!=h:raise ValueError('Effect pipeline source changed: '+name)
    for name,h in proof['inputs'].items():
        if sha(Path(name).read_bytes())!=h:raise ValueError('Effect pipeline input changed: '+name)
    summary=proof['summary'];chart=proof['chart']
    plt.rcParams.update({'font.family':'DejaVu Sans','text.color':'#e6edf7',
        'axes.labelcolor':'#c4d1e4','xtick.color':'#aabed8','ytick.color':'#aabed8',
        'axes.edgecolor':'#34445c','axes.facecolor':'#142238'})
    fig=plt.figure(figsize=(16,12),facecolor='#0d1727')
    grid=fig.add_gridspec(2,2,left=.23,right=.96,bottom=.22,top=.78,hspace=.45,wspace=.85)
    ax=fig.add_subplot(grid[0,:])
    times=[r['time'] for r in chart]
    for key,label,color in [('creationRequested','Creation requested; runtime not activated','#6dcfc0'),
        ('removalRequested','Removal requested; no immediate deletion inferred','#e3b86c'),
        ('removalWithoutObservedCreation','Removal without observed creation','#b892d8')]:
        ax.step(times,[r[key] for r in chart],where='post',label=label,color=color,linewidth=2)
    ax.set_xlabel('Recorded match time (seconds)');ax.set_ylabel('Indexed effect IDs')
    ax.legend(frameon=False,labelcolor='#d9e6f7',fontsize=9,loc='upper left')
    ax.spines[['top','right']].set_visible(False)
    ax=fig.add_subplot(grid[1,0])
    values=[summary[k] for k in ['creationRequests','preparedResourceRequests',
        'requestsWithGpuBindings','requestsWithAllGpuBindings']]
    labels=['Recorded creation requests','Prepared context resource',
        'At least one GPU emitter','Bindings for every emitter']
    ax.barh(labels,values,color=['#759abc','#6dcfc0','#69afc7','#e3b86c']);ax.invert_yaxis()
    ax.set_xlim(0,summary['creationRequests']*1.15)
    for i,n in enumerate(values):ax.text(n+25,i,str(n),va='center',color='#e6edf7',fontsize=10)
    ax.set_title('Static preparation for actual requests',color='#e6edf7',fontsize=12,pad=15)
    ax.spines[['top','right']].set_visible(False)
    ax=fig.add_subplot(grid[1,1])
    gaps=sorted(summary['resourceGaps'].items(),key=lambda x:-x[1])
    labels={'resource-context-entity-unresolved':'Context entity unresolved',
        'resource-key-absent-from-context-catalog':'Key absent from context catalog',
        'alternate-name-registry-unresolved':'Alternate-name registry unresolved',
        'null-object-link':'Explicit null resource link'}
    ax.barh([labels[k] for k,n in gaps],[n for k,n in gaps],color='#b892d8');ax.invert_yaxis()
    ax.set_title('Resource lookup gaps',color='#e6edf7',fontsize=12,pad=15)
    ax.spines[['top','right']].set_visible(False)
    fig.text(.05,.95,'One effect-request pipeline across the replay',fontsize=25,weight='bold')
    fig.text(.05,.91,f"Build {proof['build']} · 120-second ARAM fixture · {summary['creationRequests']:,} creations + {summary['removalRequests']:,} removals",fontsize=13,color='#aec4df')
    fig.text(.05,.865,'All requests retain original descriptors, identity, source ordering and removal flags; seeking reconstructs the same request state.',fontsize=11,color='#8ed3c7')
    fig.text(.05,.16,'Shared runtime work remains: factory finalization, parent activation, attachment/registry resolution, clocks/seeds and retirement.',fontsize=11,color='#e3b86c')
    fig.text(.05,.12,'GPU binding counts describe prepared emitter inputs. They do not establish successful effect activation, rendered spells or A/V parity.',fontsize=11,color='#e3b86c')
    fig.text(.05,.08,f"{proof['counts']['descriptorFieldChecks']:,} native descriptor field checks · {proof['counts']['snapshotChecks']:,} forward/reverse snapshot checks · prior replay tracks preserved",fontsize=10,color='#aec4df')
    fig.text(.05,.045,'This is a pipeline diagnostic. The existing missile preview remains partial; no new spell coverage is inferred from this chart.',fontsize=10,color='#aec4df')
    fig.savefig(a.output,dpi=110,facecolor=fig.get_facecolor());plt.close(fig)
    result={'schema':1,'kind':'effect-pipeline-coverage-visual','comparisonSha256':sha(raw),
        'rendererSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(a.output.read_bytes()),
        'scope':proof['scope']}
    a.output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result))


if __name__=='__main__':main()
