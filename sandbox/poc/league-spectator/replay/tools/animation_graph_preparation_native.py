"""Original animation repository construction and graph runtime preparation."""
from unicorn import x86_const as r
from vfx_spawn_native import name_hash


def initialize_animation_repository(n):
    if n.q(n.base+0x24712c0):raise ValueError('Original animation repository is not cold')
    owner=n.allocate(0x128);n.u.mem_write(owner+0x28,b'\xa5'*0x100)
    n.call(0x15ae760,{r.UC_X86_REG_RDI:owner})
    if (n.q(n.base+0x24712c0)!=owner or n.q(owner+0x10)!=owner+0x18 or
            n.q(owner+0x18) or n.q(owner+0x20) or
            bytes(n.u.mem_read(owner+0x28,0x100))!=b'\xa5'*0x100):
        raise ValueError('Original animation repository publication/header/guard differs')
    return {'object':owner,'originalConstructorRva':0x15ae760,
            'originalBootCallRva':0x665d5f,'fullConstructorExecuted':True,'guardIntact':True,
            'headerHex':bytes(n.u.mem_read(owner,0x28)).hex(),
            'animationPayloadsLoaded':False,'mainViewerExpanded':False}


def graph_tracks(n,graph):
    descriptor=n.types[name_hash('AnimationGraphData')]
    if n.q(descriptor+0x40)!=0x98 or not n.library_pointer(graph,0x98):
        raise ValueError('Exact owned AnimationGraphData layout required')
    rows,count=n.q(graph+0x28),n.u32(graph+0x30)
    if count>4096 or count and not n.library_pointer(rows,count*20):
        raise ValueError('Original animation track map escaped owned bounds')
    tracks=[]
    for i in range(count):
        at=rows+i*20
        tracks.append({'key':n.u32(at),'priority':n.u.mem_read(at+4,1)[0],
                       'blendMode':n.u.mem_read(at+5,1)[0],'index':n.u32(at+12),'runtimeKey':n.u32(at+16)})
    if len({row['key'] for row in tracks})!=count:raise ValueError('Duplicate authored animation track keys')
    return tracks


def prepare_animation_graph(n,graph):
    if not n.q(n.base+0x24712c0) or n.asset_work_queue is None:
        raise ValueError('Original animation repository and owned read queue required')
    before=graph_tracks(n,graph)
    if any(row['index']!=0xffffffff for row in before):
        raise ValueError('Animation preparation control requires unassigned track indices')
    record={'graph':graph,'originalPreparationRva':0x15afe30,'originalSkinLoadCallRva':0x2a7872,
            'tracksBefore':before,'tracksAfter':None,'completed':False}
    n.animation_graph_preparations.append(record)
    # Complete original graph preparation, including clip virtual callbacks,
    # name lookups, priority sorting and asset requests. No track value is set
    # by the adapter and no callback is bypassed.
    n.call(0x15afe30,{r.UC_X86_REG_RDI:graph})
    after=graph_tracks(n,graph)
    if (len(after)!=len(before) or sorted(row['index'] for row in after)!=list(range(len(after))) or
            any((a['key'],a['priority'],a['blendMode'])!=(b['key'],b['priority'],b['blendMode']) or
                a['runtimeKey']!=a['key'] for a,b in zip(after,before))):
        raise ValueError('Original animation graph preparation did not assign bounded dense track indices')
    record.update(completed=True,tracksAfter=after,
                  scope={'originalGraphPreparationCompleted':True,
                    'animationPayloadsLoaded':False,'animatedPoseVerified':False,'mainViewerExpanded':False})
    return record
