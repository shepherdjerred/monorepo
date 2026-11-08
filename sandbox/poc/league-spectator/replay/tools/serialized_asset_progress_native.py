"""Observe bounded, newly read source ranges in the original memory reader."""
from bisect import bisect_left
import unicorn
from unicorn import x86_const as r


def observe_serialized_asset_progress(n,on_source_end=None):
    records=[];active={};sources={};totals={'coveredBytes':0,'readCalls':0};hooks=[]
    def enter(engine,address,size,user):
        stack=engine.reg_read(r.UC_X86_REG_RSP);stream=engine.reg_read(r.UC_X86_REG_RDI)
        if stack in active or not n.library_pointer(stream,0x28):
            raise ValueError('Original serialized reader frame/object exceeds owned bounds')
        vt=n.q(stream)
        if not n.base+0x1fef000<=vt<=n.base+len(n.image)-0x18 or n.q(vt+0x10)!=n.base+0x1479130:
            raise ValueError('Observed serialized reader vtable does not dispatch the original method')
        data,length,cursor=n.q(stream+8),n.q(stream+0x10),n.q(stream+0x18)
        requested=engine.reg_read(r.UC_X86_REG_RDX)
        if length>0x800000 or cursor>length or length and not n.library_pointer(data,length):
            raise ValueError('Original serialized source exceeds its declared owned byte range')
        key=(stream,data,length);record=sources.get(key)
        if record is None:
            if len(records)>=1024:raise ValueError('Serialized source observation exceeds its source-count bound')
            record={'stream':stream,'data':data,'sourceBytes':length,'vtableRva':vt-n.base,
                    'readCalls':0,'coveredBytes':0,'ranges':[],'furthestReadEnd':0,'reachedSourceEnd':False}
            records.append(record);sources[key]=record
        active[stack]=(record,cursor,min(requested,length-cursor))
    def leave(engine,address,size,user):
        state=active.pop(engine.reg_read(r.UC_X86_REG_RSP),None)
        if state is None:raise ValueError('Original serialized reader returned without an observed frame')
        record,start,count=state;stream=record['stream'];end=start+count
        if (engine.reg_read(r.UC_X86_REG_RAX)!=count or n.q(stream+8)!=record['data'] or
                n.q(stream+0x10)!=record['sourceBytes'] or n.q(stream+0x18)!=end):
            raise ValueError('Original serialized read result/cursor differs from its declared source bounds')
        record['readCalls']+=1;totals['readCalls']+=1
        if count:
            # Count the union of bytes actually copied by original code.
            # Re-reading or seeking over the same data cannot create progress.
            ranges=record['ranges'];index=bisect_left(ranges,[start])
            if index and ranges[index-1][1]>=start:index-=1
            left,right=start,end;removed=0;finish=index
            while finish<len(ranges) and ranges[finish][0]<=right:
                a,b=ranges[finish];left=min(left,a);right=max(right,b);removed+=b-a;finish+=1
            added=right-left-removed;ranges[index:finish]=[[left,right]]
            if len(ranges)>4096:raise ValueError('Serialized byte coverage exceeds its interval-count bound')
            record['coveredBytes']+=added;totals['coveredBytes']+=added
            if not 0<=record['coveredBytes']<=record['sourceBytes']:
                raise ValueError('Serialized byte coverage escaped its source size')
            record['furthestReadEnd']=max(record['furthestReadEnd'],end)
        if end==record['sourceBytes'] and not record['reachedSourceEnd']:
            record['reachedSourceEnd']=True
            if on_source_end:on_source_end(record)
    for at,callback in [(0x1479130,enter),(0x1479169,leave)]:
        hooks.append(n.u.hook_add(unicorn.UC_HOOK_CODE,callback,begin=n.base+at,end=n.base+at))
        n.u.ctl_remove_cache(n.base+at,n.base+at+16)
    return {'originalReadRva':0x1479130,'originalReturnRva':0x1479169,'sources':records,'totals':totals,
            'scope':{'originalReadResultsRetained':True,'newlyCoveredSourceBytesOnly':True,
                     'completeAssetDecodeEstablished':False}},hooks
