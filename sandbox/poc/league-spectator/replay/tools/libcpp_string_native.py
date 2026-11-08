"""Bounded x86-64 libc++ string assignment at the platform-library boundary."""


ASSIGN_C_STRING = '__ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6assignEPKc'


def assign_c_string(n,destination,source):
    if not n.writable_file_memory(destination,24):
        raise ValueError('libc++ string assignment escaped owned object storage')
    data = n.cstring(source)
    long = n.u.mem_read(destination,1)[0]&1
    if long:
        allocated,length,pointer = n.q(destination)&~1,n.q(destination+8),n.q(destination+16)
        if (not 0 < allocated <= 0x10000 or length >= allocated or
                n.allocations.get(pointer,0) < allocated or not n.writable_file_memory(pointer,allocated)):
            raise ValueError('libc++ string assignment received an unowned long string')
        capacity = allocated-1
    else:
        length = n.u.mem_read(destination,1)[0]>>1
        if length > 22:raise ValueError('libc++ short string length exceeds its inline storage')
        pointer,capacity = destination+1,22
    if len(data) > capacity:
        # Match this image's original constructor recommendation at 0x11fe0.
        # Capacity growth beyond the current allocation is a library choice;
        # the preserved contract is owned storage, contents, size and NUL.
        allocated = 26 if len(data) == 23 else (len(data)|7)+1
        pointer = n.allocate(allocated)
        n.put(destination,'QQQ',allocated|1,len(data),pointer)
        long = True
    elif long:
        n.put(destination+8,'Q',len(data))
    else:
        n.u.mem_write(destination,bytes([len(data)*2]))
    n.u.mem_write(pointer,data+b'\0')
    return {'object':destination,'inputHex':data.hex(),'bytes':len(data),'longStorage':bool(long),
            'nativeConstructorLayoutRva':0x11fe0,'oldAllocationReclaimed':False}
