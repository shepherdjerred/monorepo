"""Restore the verified AI-constructor dependency control, then construct units.

This is not a live match bootstrap. Mode references, asset readiness and world
routing remain explicit unresolved dependencies.
"""
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from game_mode_data_native import NativeGameModeData
from vfx_spawn_native import ADDRESSES,sha


class NativeAIUnitFixture:
    def __init__(self,cache,client,native_class=NativeGameModeData):
        self.cache = Path(cache).resolve()
        self.root = Path(__file__).resolve().parents[1]
        self.inputs = {}
        reference = self.read(self.cache/'research/game-mode-data-native.json')
        if not (reference['scope']['fullAiUnitConstructorCompleted'] and reference['unitProbe']['completed'] and
                reference['timeProbe']['completed'] and not reference['scope']['readyGlobalProviderEstablished']):
            raise ValueError('Matching scoped completed AI-base constructor evidence required')
        for path,digest in reference['inputs'].items():
            if sha(self.raw(Path(path))) != digest:
                raise ValueError('AI constructor input changed: '+path)
        for name,digest in reference['sources'].items():
            if sha(self.raw(self.root/'tools'/name)) != digest:
                raise ValueError('AI constructor producer changed: '+name)
        if not issubclass(native_class,NativeGameModeData):
            raise ValueError('AI fixture requires the original game-mode reader contract')
        n = self.native = native_class(self.cache/'public/decoder-16.21-macos',Path(client))
        if reference['decoderImageSha256'] != sha(n.image):
            raise ValueError('Matching AI constructor image required')
        for block in reference['originalBlocks']:
            if sha(n.image[block['rva']:block['rva']+block['size']]) != block['sha256']:
                raise ValueError('Original AI constructor instructions changed')
        snapshot = reference['snapshot']
        heap = bytes.fromhex(snapshot['heapHex'])
        if snapshot['heapAddress'] != 0x10400000 or snapshot['nextHeap'] != 0x10400000+len(heap):
            raise ValueError('AI constructor owned heap bounds differ')
        n.u.mem_write(snapshot['heapAddress'],heap)
        for patch in snapshot['imagePatches']:
            if patch['rva'] < 0x1fef000 or patch['rva'] % 4096 or len(bytes.fromhex(patch['bytesHex'])) != 4096:
                raise ValueError('AI constructor snapshot would patch code/unbounded data')
            n.u.mem_write(n.base+patch['rva'],bytes.fromhex(patch['bytesHex']))
        allocations = {int(address):size for address,size in snapshot['allocations'].items()}
        if any(address < 0x10400000 or not 0 <= size <= snapshot['nextHeap']-address for address,size in allocations.items()):
            raise ValueError('AI constructor allocation ownership differs')
        n.next_heap,n.allocations = snapshot['nextHeap'],allocations
        n.mutexes = {int(address):value for address,value in snapshot['mutexes'].items()}
        n.clock_inputs = dict(reference['platformClock']['inputs'])
        n.clock_calls = []
        config = n.allocate(0x60)
        n.call(0x6143e0,{r.UC_X86_REG_RDI:config})
        if n.q(n.base+0x246c568) != config:
            raise ValueError('Original loading configuration global differs')
        self.loading_configuration = {'object':config,'constructorRva':0x6143e0,
                                      'bytesHex':bytes(n.u.mem_read(config,0x60)).hex(),
                                      'runtimeOverridesRecovered':False}
        n.u.hook_add(unicorn.UC_HOOK_CODE,lambda engine,address,size,user:engine.emu_stop(),
                     begin=ADDRESSES['stop'],end=ADDRESSES['stop'])
        self.reference = reference

    def raw(self,path):
        data = path.read_bytes()
        self.inputs[str(path.resolve())] = sha(data)
        return data

    def read(self,path):
        return json.loads(self.raw(path))

    def construct_ai(self):
        n = self.native
        unit = n.allocate(0x4100)
        n.u.mem_write(unit+0x4000,bytes([0xa5])*0x100)
        n.call(0xbc980,{r.UC_X86_REG_RDI:unit})
        if (n.q(unit)-n.base != 0x22ec2d0 or n.q(unit+0xb28)-n.base != 0x22ed708 or
                n.q(unit+0x35e0+0x128) != unit+0xb28):
            raise ValueError('Original AI-base constructor interfaces differ')
        self.check_guard(unit)
        return unit

    def check_guard(self,unit):
        if bytes(self.native.u.mem_read(unit+0x4000,0x100)) != bytes([0xa5])*0x100:
            raise ValueError('Native AI unit escaped its owned region')

    def run_to(self,start,end,registers,allow_return=False):
        n = self.native
        n.u.context_restore(n.initial)
        n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        n.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack'])
        for register,value in registers.items():
            n.u.reg_write(register,value)
        n.u.ctl_remove_cache(n.base+min(start,end),n.base+max(start,end))
        n.u.emu_start(n.base+start,n.base+end,count=5000000)
        actual = n.u.reg_read(r.UC_X86_REG_RIP)
        if actual != n.base+end and not (allow_return and actual == ADDRESSES['stop']):
            raise ValueError('Native AI operation escaped explicit instruction boundary')
        return 'projection-boundary' if actual == n.base+end else 'handler-returned'

    def initialize_default_storage(self,unit,name,skin,namespace=''):
        n = self.native
        source = n.allocate(0x28)
        for offset,value in [(0,name),(0x10,namespace)]:
            n.call(0x14c2d60,{r.UC_X86_REG_RDI:source+offset,r.UC_X86_REG_RSI:n.allocate_text(value)})
        n.put(source+0x20,'II',skin,0)
        self.run_to(0x67c20,0x67c57,{r.UC_X86_REG_RDI:unit+0x35e0,r.UC_X86_REG_RSI:source})
        self.check_guard(unit)
