"""Original startup construction and inspection of the named-record registry."""
from unicorn import x86_const as r


def initialize_runtime_name_registry(n):
    if n.q(n.base+0x246ece0):raise ValueError('Original runtime name registry must be cold')
    # Complete independent allocation/inline-construction/publication block.
    # Both tree sentinels and counts are written by the original instructions.
    n.call(0x66a546,{},0x66a57f)
    pointer=n.q(n.base+0x246ece0)
    if (n.allocations.get(pointer)!=0x38 or n.q(pointer)!=n.base+0x2348ec8 or
            n.q(pointer+8)!=pointer+0x10 or n.q(pointer+0x20)!=pointer+0x28 or
            any(n.q(pointer+offset) for offset in [0x10,0x18,0x28,0x30])):
        raise ValueError('Original named-record registry publication or empty trees differ')
    return {'object':pointer,'originalStartupBlock':[0x66a546,0x66a57f],
            'globalRva':0x246ece0,'vtableRva':0x2348ec8,
            'scope':{'originalInlineConstruction':True,'recordNamesSupplied':False,
                     'recordPointersSupplied':False,'fullStartupExecuted':False,'mainViewerExpanded':False}}


def inspect_runtime_name_registry(n,initialization):
    pointer=initialization['object']
    if n.q(n.base+0x246ece0)!=pointer or n.q(pointer)!=n.base+0x2348ec8:
        raise ValueError('Original named-record registry identity changed')
    def nodes(root,count):
        if count>4096:raise ValueError('Named-record registry exceeds the bounded control')
        pending=[root] if root else [];visited=set();result=[]
        while pending:
            at=pending.pop()
            if at in visited or not n.library_pointer(at,0x38):
                raise ValueError('Named-record tree cycles or exceeds owned node bounds')
            visited.add(at);result.append(at)
            for child in [n.q(at),n.q(at+8)]:
                if child:pending.append(child)
        if len(result)!=count:raise ValueError('Named-record tree count differs from native nodes')
        return result
    named=nodes(n.q(pointer+0x10),n.q(pointer+0x18))
    hashed=nodes(n.q(pointer+0x28),n.q(pointer+0x30))
    def string(at):
        data,length=n.q(at),n.u32(at+8)
        if length>4096 or not n.library_pointer(data,length+1) or n.u.mem_read(data+length,1)[0]:
            raise ValueError('Named-record string exceeds owned terminated storage')
        return data,bytes(n.u.mem_read(data,length))
    by_hash={}
    for at in hashed:
        key=n.u32(at+0x20)
        if key in by_hash:raise ValueError('Duplicate key in original named-record hash tree')
        by_hash[key]=string(at+0x28)[1]
    records=[]
    for at in named:
        data,name=string(at+0x20);record=n.q(at+0x30)
        if not n.library_pointer(record,0x20) or string(record+0x10)[1]!=name:
            raise ValueError('Original named-record entry differs from its registered record')
        n.call(0x144b3a0,{r.UC_X86_REG_RDI:data});key=n.u.reg_read(r.UC_X86_REG_EAX)
        if key not in by_hash:raise ValueError('Original named-record hash tree omitted a registered key')
        records.append({'nameHex':name.hex(),'record':record,'nativeHash':key,
                        'hashCanonicalNameMatches':by_hash[key]==name})
    if any(value not in {bytes.fromhex(row['nameHex']) for row in records} for value in by_hash.values()):
        raise ValueError('Original hashed name has no named registry entry')
    return {'object':pointer,'namedCount':len(named),'hashedCount':len(hashed),'records':records,
            'scope':{'originalRegistryInspected':True,'acceptedReplayEntityRegistration':False,
                     'mainViewerExpanded':False}}
