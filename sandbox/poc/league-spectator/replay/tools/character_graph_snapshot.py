"""Local owned-memory snapshots for the exact native character graph probe.

These snapshots are research inputs, never browser packages or saved matches.
Executable pages cannot be restored from them.
"""
from pathlib import Path
from vfx_spawn_native import sha

HEAP_START = 0x10400000
ARENA_END = 0x12000000
DATA_START = 0x1fef000


def capture(n,path):
    path = Path(path)
    if not HEAP_START <= n.next_heap <= ARENA_END:
        raise ValueError('Character snapshot heap exceeds owned arena')
    heap = bytes(n.u.mem_read(HEAP_START,n.next_heap-HEAP_START))
    path.write_bytes(heap)
    patches = []
    for rva in range(DATA_START,len(n.image),4096):
        data = bytes(n.u.mem_read(n.base+rva,min(4096,len(n.image)-rva)))
        if data != n.image[rva:rva+len(data)]:
            patches.append({'rva':rva,'bytesHex':data.hex()})
    if n.object_attrs or any(value['depth'] for value in n.character_mutexes.values()) or any(n.mutexes.values()):
        raise ValueError('Character snapshot cannot retain synchronization ownership')
    return {'schema':1,'kind':'owned-native-character-graph-snapshot',
            'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
            'decoderImageSha256':sha(n.image),'heapPath':str(path.resolve()),'heapSha256':sha(heap),
            'heapAddress':HEAP_START,'nextHeap':n.next_heap,'baselineHeap':n.baseline_heap,
            'heapHighWater':n.heap_high_water,'allocations':n.allocations,'imagePatches':patches,
            'types':n.types,'mutexes':n.mutexes,'characterMutexes':n.character_mutexes,'slots':n.slots,
            'clockInputs':n.clock_inputs,
            'scope':{'localResearchOnly':True,'executablePagesCaptured':False,
                     'readyAssets':False,'unitCallbacksExecuted':False,'liveWorld':False}}


def restore(fixture,snapshot):
    n = fixture.native
    if (snapshot['schema'] != 1 or snapshot['kind'] != 'owned-native-character-graph-snapshot' or
            snapshot['build'] != n.profile['clientVersion'] or snapshot['protocol'] != n.profile['protocolDigest'] or
            snapshot['decoderImageSha256'] != sha(n.image) or not snapshot['scope']['localResearchOnly'] or
            snapshot['scope']['executablePagesCaptured']):
        raise ValueError('Exact local character snapshot required')
    data = fixture.raw(Path(snapshot['heapPath']))
    if (sha(data) != snapshot['heapSha256'] or snapshot['heapAddress'] != HEAP_START or
            snapshot['nextHeap'] != HEAP_START+len(data) or snapshot['nextHeap'] > ARENA_END):
        raise ValueError('Character snapshot heap changed or escaped owned arena')
    allocations = {int(at):size for at,size in snapshot['allocations'].items()}
    if any(at < HEAP_START or not 0 <= size <= snapshot['nextHeap']-at for at,size in allocations.items()):
        raise ValueError('Character snapshot allocation ownership differs')
    n.u.mem_write(HEAP_START,data)
    seen = set()
    for patch in snapshot['imagePatches']:
        rva = patch['rva']
        encoded = bytes.fromhex(patch['bytesHex'])
        if (rva < DATA_START or rva % 4096 or rva in seen or rva >= len(n.image) or
                len(encoded) != min(4096,len(n.image)-rva)):
            raise ValueError('Character snapshot would replace executable or unbounded data')
        seen.add(rva)
        n.u.mem_write(n.base+rva,encoded)
    n.next_heap,n.allocations = snapshot['nextHeap'],allocations
    n.baseline_heap,n.heap_high_water = snapshot['baselineHeap'],snapshot['heapHighWater']
    if not HEAP_START <= n.baseline_heap <= n.heap_high_water <= n.next_heap:
        raise ValueError('Character snapshot allocation bounds differ')
    n.types = {int(identity):pointer for identity,pointer in snapshot['types'].items()}
    if len(n.types) > 4096 or any(not n.base+DATA_START <= pointer <= n.base+len(n.image)-0x88 or
                                 n.u32(pointer+8) != identity for identity,pointer in n.types.items()):
        raise ValueError('Character snapshot type descriptor differs')
    n.type_catalog = n.catalog()
    n.mutexes = {int(at):value for at,value in snapshot['mutexes'].items()}
    n.character_mutexes = {int(at):value for at,value in snapshot['characterMutexes'].items()}
    if any(n.mutexes.values()) or any(value['depth'] for value in n.character_mutexes.values()):
        raise ValueError('Character snapshot retained synchronization ownership')
    n.slots = {int(at):value for at,value in snapshot['slots'].items()}
    n.clock_inputs = dict(snapshot['clockInputs'])
    n.object_attrs,n.object_os_calls = {},[]
