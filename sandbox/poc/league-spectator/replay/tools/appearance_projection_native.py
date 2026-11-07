"""Continue one original appearance projection in observed bounded CPU slices."""
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


def observe_mesh_progress(n):
    """Read original mesh-loop indices; never change a register or mesh value."""
    records=[];active={}
    def enter(engine,address,size,user):
        mesh=engine.reg_read(r.UC_X86_REG_RDI)
        definition=engine.reg_read(r.UC_X86_REG_RSI)
        stack=engine.reg_read(r.UC_X86_REG_RSP)
        if len(records)>=256 or not n.library_pointer(mesh,0xa0) or not n.library_pointer(definition,0x30):
            raise ValueError('Original mesh progress input escaped owned bounds')
        count=n.u32(mesh+0x98);indices=n.q(mesh+0x90)
        materials=n.u32(definition+0x28);rows=n.q(definition+0x20)
        if (count>3000000 or count%3 or count and not n.library_pointer(indices,count*4) or
                materials>255 or materials and not n.library_pointer(rows,materials*0x78)):
            raise ValueError('Original mesh topology exceeds explicit progress bounds')
        groups=[]
        for material in range(materials):
            for lod in range(6):
                row=rows+material*0x78
                start,length=n.u32(row+0x48+lod*4),n.u32(row+0x60+lod*4)
                if length%3 or start+length>count:
                    raise ValueError('Original mesh group index range exceeds its source topology')
                groups.append((start,length))
        record={'mesh':mesh,'definition':definition,'sourceIndices':count,'materials':materials,
                'triangleBound':sum(length//3 for _,length in groups),'trianglesVisited':0,
                'lastTriangle':None,'completed':False}
        if record['triangleBound']>1000000 or stack in active:
            raise ValueError('Original mesh progress frame or triangle bound differs')
        records.append(record);active[stack]=(record,groups)
    def triangle(engine,address,size,user):
        frame=engine.reg_read(r.UC_X86_REG_RBP)
        state=active.get(frame+8)
        if state is None:raise ValueError('Original mesh triangle has no observed entry frame')
        record,groups=state
        material=n.q(frame-0x108);lod=n.q(frame-0x140)
        local=engine.reg_read(r.UC_X86_REG_RCX)
        index=engine.reg_read(r.UC_X86_REG_RAX)&0xffffffff
        if material>=record['materials'] or lod>=6:
            raise ValueError('Original mesh progress group escaped source bounds')
        start,length=groups[material*6+lod]
        position=[material,lod,local]
        if (local%3 or local+3>length or index!=start+local or
                record['lastTriangle'] is not None and position<=record['lastTriangle']):
            raise ValueError('Original mesh triangle failed monotonic source-index progress')
        record['lastTriangle']=position;record['trianglesVisited']+=1
        if record['trianglesVisited']>record['triangleBound']:
            raise ValueError('Original mesh progress exceeded authored triangles')
    def leave(engine,address,size,user):
        state=active.pop(engine.reg_read(r.UC_X86_REG_RSP),None)
        if state is None:raise ValueError('Original mesh return has no observed entry frame')
        record,_=state
        if record['trianglesVisited']!=record['triangleBound']:
            raise ValueError('Original mesh returned before visiting every authored triangle')
        record['completed']=True
    hooks=[]
    # Exact-build entry, triangle-loop header and return. The binary profile
    # validates the image; these observers execute no replacement game code.
    for address,callback in [(0x1846310,enter),(0x184648e,triangle),(0x1847b8e,leave)]:
        hooks.append(n.u.hook_add(unicorn.UC_HOOK_CODE,callback,begin=n.base+address,end=n.base+address))
        n.u.ctl_remove_cache(n.base+address,n.base+address+16)
    return records,hooks


def project_appearance(n,projection,measure):
    n.projection_execution = {'entryRva':0x668c0,'sliceInstructionBound':5000000,
                              'sliceCountBound':16,'completed':False,'progress':[]}
    n.u.context_restore(n.initial)
    n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
    n.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack'])
    n.u.reg_write(r.UC_X86_REG_RDI,projection)
    n.u.reg_write(r.UC_X86_REG_RSI,0)
    start = n.base+0x668c0
    mesh_records,hooks=observe_mesh_progress(n)
    n.projection_execution['meshProgress']=mesh_records
    def sample():
        result=dict(measure())
        if 'meshTriangles' in result:raise ValueError('Reserved appearance progress counter')
        result['meshTriangles']=sum(row['trianglesVisited'] for row in mesh_records)
        return result
    try:
        for _ in range(16):
            before = sample()
            if not before or len(before) > 32 or any(not isinstance(value,int) or value < 0 for value in before.values()):
                raise ValueError('Appearance projection progress sample escaped explicit counter bounds')
            n.u.emu_start(start,ADDRESSES['stop'],count=5000000)
            start = n.u.reg_read(r.UC_X86_REG_RIP)
            after = sample()
            if after.keys() != before.keys() or any(after[key] < value for key,value in before.items()):
                raise ValueError('Appearance projection progress counters changed identity or moved backward')
            n.projection_execution['progress'].append({key:after[key]-value for key,value in before.items()})
            if start == ADDRESSES['stop']:
                n.projection_execution['completed'] = True
                return n.projection_execution
            if after == before:
                raise ValueError('Appearance projection exhausted a CPU slice without observed loader progress')
        raise ValueError('Appearance projection exceeded sixteen bounded CPU slices')
    finally:
        for hook in hooks:n.u.hook_del(hook)
