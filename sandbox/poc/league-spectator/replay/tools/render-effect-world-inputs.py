"""Render the verified world-input dependency diagnostic, never gameplay."""
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from vfx_spawn_native import sha


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);args=p.parse_args()
    cache=args.cache.resolve();root=Path(__file__).parent.parent;inputs={}
    def raw(path):
        b=path.read_bytes();inputs[str(path.resolve())]=sha(b);return b
    def read(path):return json.loads(raw(path))
    proof=read(cache/'research/effect-world-inputs-comparison.json')
    admission=read(cache/'research/replay-descriptors-native.json')
    if (proof['mismatchCount'] or proof['counts']['creationJoins']!=2224 or
            proof['counts']['pointerFieldsCompared']!=44 or proof['counts']['formerThreeFieldFalseAdmissions']!=466 or
            admission['counts']['detachedCandidates']!=0 or not admission['scope']['allFourEntityReferenceFieldsRequiredZero']):
        raise ValueError('Complete corrected world-input evidence required')
    for name,digest in proof['sources'].items():
        if sha(raw(root/name))!=digest:raise ValueError('World-input source changed')
    for path,digest in proof['inputs'].items():
        if sha(raw(Path(path)))!=digest:raise ValueError('World-input proof source changed')
    summary=proof['summary'];fig=plt.figure(figsize=(16,9),facecolor='#101923')
    fig.text(.055,.935,'Replay effects need the live unit world',color='white',fontsize=25,weight='bold')
    fig.text(.055,.89,'Build 16.21.829.8620 | 2,224 creation requests in the decoded 120-second fixture',color='#bacbdc',fontsize=12)
    for x,value,label in [(.055,summary['requestsWithEntityReferences'],'requests reference world entities'),
            (.405,summary['requestsWithoutEntityReferences'],'requests have four null entity inputs'),
            (.755,0,'admitted complete detached requests')]:
        fig.text(x,.79,f'{value:,}',color='#78d5c2' if value else '#edc98e',fontsize=33,weight='bold')
        fig.text(x,.748,label,color='#bacbdc',fontsize=11)
    ax=fig.add_axes([.245,.325,.68,.34],facecolor='#101923')
    names=['resourceContextEntityId','attachmentEntityId','lookup14EntityId','lookupA8EntityId']
    labels=['Resource owner','Attachment entity','Lookup 0x14 entity','Lookup 0xA8 entity']
    values=[summary['nonzeroFields'][k] for k in names]
    bars=ax.barh(labels[::-1],values[::-1],color=['#66a9cf','#66a9cf','#66a9cf','#edc98e'])
    ax.set_xlim(0,2224);ax.tick_params(colors='#bacbdc',labelsize=12)
    ax.spines[['top','right','left']].set_visible(False);ax.spines['bottom'].set_color('#425263')
    ax.set_xlabel('Requests with a nonzero ID (roles overlap)',color='#bacbdc',labelpad=10)
    for bar,value in zip(bars,values[::-1]):ax.text(value+24,bar.get_y()+bar.get_height()/2,f'{value:,}',va='center',color='white',fontsize=12)
    fig.text(.055,.245,'Verified: original world lookup + four descriptor pointer stores in native and WASM.',color='#78d5c2',fontsize=13)
    fig.text(.055,.193,'Required next: live unit resource stacks, overlay changes, attachment poses and global asset lookup.',color='#edc98e',fontsize=13)
    fig.text(.055,.136,'Correction: a three-field guard missed 466 requests. Earlier unitless factory probes are invalid as replay evidence.',color='#edc98e',fontsize=11)
    fig.text(.055,.075,'Dependency diagnostic only. Supplied base-unit controls do not reconstruct live heroes. No additional preview spells enabled.',color='#bacbdc',fontsize=11)
    out=cache/'public/evidence/latest-effect-world-inputs.png';fig.savefig(out,dpi=100,facecolor=fig.get_facecolor());plt.close(fig)
    result={'schema':1,'kind':'effect-world-input-dependency-diagnostic','inputs':inputs,'rendererSha256':sha(Path(__file__).read_bytes()),
        'imageSha256':sha(out.read_bytes()),'counts':proof['counts'],'summary':summary,
        'scope':{'diagnosticOnly':True,'gameplayRendered':False,'liveWorldReconstructed':False,'mainViewerExpanded':False}}
    out.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(out),'sha256':result['imageSha256']}))


if __name__=='__main__':main()
