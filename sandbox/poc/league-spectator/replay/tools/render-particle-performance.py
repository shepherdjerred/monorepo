"""Plot the verified CPU workload comparison; this is not browser frame rate."""
import argparse
import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def sha(data):return hashlib.sha256(data).hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path)
    args=p.parse_args();cache=args.cache.resolve();raw=(cache/'research/particle-bulk-comparison.json').read_bytes()
    data=json.loads(raw)
    if data['mismatches'] or data['scope']['browserPerformanceEstablished'] or data['counts']['geometryDigestChecks']!=10020:
        raise ValueError('Unverified or mislabeled particle performance data')
    for path,digest in data['inputs'].items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Particle comparison input changed')
    plt.rcParams.update({'font.family':'DejaVu Sans','text.color':'#e9eef7'})
    fig,axes=plt.subplots(1,3,figsize=(13,6.2),facecolor='#101822')
    fig.subplots_adjust(left=.09,right=.97,top=.68,bottom=.34,wspace=.3)
    for ax,key,title in zip(axes,['medianMs','p95Ms','maxMs'],['Median update','95th percentile','Longest update']):
        ax.set_facecolor('#101822');values=[data['baseline'][key],data['bulk'][key]]
        ax.barh([1,0],values,height=.48,color=['#bd8be0','#65c7b3'])
        for y,value in zip([1,0],values):ax.text(value+20,y,f'{value:,.0f} ms',va='center',fontsize=12)
        ax.set_xlim(0,2300);ax.set_xticks([]);ax.set_yticks([1,0],['Original copy','Bulk copy'],color='#b8c9dc',fontsize=10)
        ax.tick_params(axis='y',length=0);ax.set_title(title,color='#e9eef7',fontsize=14,pad=15)
        for spine in ax.spines.values():spine.set_visible(False)
    fig.text(.045,.91,'Particle playback: measured CPU cost',fontsize=23,weight='bold')
    fig.text(.045,.845,'Same pinned WASM binary and native memory API; byte-by-byte host reads replaced with bulk copies.',fontsize=11,color='#b8c9dc')
    fig.text(.045,.77,'Two full Vladimir bursts · 30 recorded missiles · up to 165 simultaneous emitter draws',fontsize=12,color='#b8c9dc')
    fig.text(.045,.23,f"Exact output agreement: {data['counts']['geometryDigestChecks']:,} geometry digests across {data['counts']['samples']:,} pool samples.",fontsize=12,color='#65c7b3')
    fig.text(.045,.16,'Long stalls remain. These sampled CPU updates include forward playback and seeks; real-time playback is not established.',fontsize=10,color='#e2b56c')
    fig.text(.045,.09,'One profiled pass per implementation on this host. Browser scheduling, GPU submission and shader compilation excluded.',fontsize=10,color='#91a4bd')
    destination=cache/'public/evidence/latest-particle-performance.png';destination.parent.mkdir(parents=True,exist_ok=True)
    fig.savefig(destination,dpi=130,facecolor=fig.get_facecolor());plt.close(fig)
    summary={'schema':1,'kind':'particle-playback-performance-visual','comparisonSha256':sha(raw),
        'imageSha256':sha(destination.read_bytes()),'rendererSha256':sha(Path(__file__).read_bytes()),
        'counts':data['counts'],'scope':data['scope']}
    destination.with_suffix('.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(destination),'sha256':summary['imageSha256']}))


if __name__=='__main__':main()
