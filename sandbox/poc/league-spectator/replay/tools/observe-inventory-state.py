"""Execute original inventory slot primitives over owned minimal storage.

Recorded field projections supply explicit inputs. Original slot getters, item
storage initialization, assignment/clear/destruction and pointer swaps execute.
Full packet callbacks, resource lookup, spell and UI side effects do not execute.
Opaque scalarB4 accumulation/compatibility rules remain outside this component.
"""
import argparse,json,struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn,sha

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['cache','client']:p.add_argument(key,type=Path)
    a=p.parse_args();cache=a.cache.resolve();path=cache/'research/inventory-native.json';source=json.loads(path.read_bytes())
    n=NativeSpawn(cache/'public/decoder-16.21-macos',a.client);entities={};definitions={};observations=[]
    def initialize(entity):
        inv=n.allocate(0x300);n.u.mem_write(inv,bytes(0x300));n.put(inv,'Q',n.base+0x22fb320)
        for i in range(39):
            row=n.allocate(0x18);n.u.mem_write(row,bytes(0x18));n.put(inv+0x40+i*8,'Q',row)
        entities[entity]=(inv,set());return entities[entity]
    def slot(inv,i):
        n.call(0x173270,{r.UC_X86_REG_RDI:inv,r.UC_X86_REG_ESI:i});return n.u.reg_read(r.UC_X86_REG_RAX)
    def clear(inv,i):n.call(0x5a6ab0,{r.UC_X86_REG_RDI:slot(inv,i)})
    def put(inv,f):
        if not f['count']:return
        if f['itemId']not in definitions:
            d=n.allocate(0x700);n.u.mem_write(d,bytes(0x700));n.put(d+0xb4,'I',f['itemId']);definitions[f['itemId']]=d
        component=n.allocate(0x128)
        n.call(0x5ae000,{r.UC_X86_REG_RDI:component,r.UC_X86_REG_RSI:definitions[f['itemId']],r.UC_X86_REG_EDX:f['counterB2']},0x5ae0d2)
        n.call(0x5aec70,{r.UC_X86_REG_RDI:component,r.UC_X86_REG_ESI:f['flagB0']})
        n.call(0x5a5fa0,{r.UC_X86_REG_RDI:slot(inv,f['slot']),r.UC_X86_REG_RSI:0,r.UC_X86_REG_RDX:component,r.UC_X86_REG_ECX:f['count'],r.UC_X86_REG_XMM0:0})
    for event in source['records']:
        inv,known=entities.get(event['entityId'])or initialize(event['entityId']);mode=event['mode']
        if mode=='snapshot':
            for i in range(10):clear(inv,i);known.add(i)
        for entry in event['entries']:
            f=entry['values']
            if mode in ['snapshot','set']:
                put(inv,f)
                if f['count']:known.add(f['slot'])
            elif mode=='swap':
                before=set(known)
                n.call(0x14967a,{r.UC_X86_REG_RDI:inv,r.UC_X86_REG_ESI:f['from'],r.UC_X86_REG_EDX:f['to']},0x149697)
                for x,y in [(f['from'],f['to']),(f['to'],f['from'])]:
                    if y in before:known.add(x)
                    else:known.discard(x)
            else:
                row=slot(inv,f['slot']);component=n.q(row+0x10)
                if mode=='counter':
                    if component:n.call(0x172052,{r.UC_X86_REG_RAX:component,r.UC_X86_REG_EDX:f['counterB2']},0x172059)
                elif mode=='stack'and not component:continue
                elif f['count']==0:clear(inv,f['slot']);known.add(f['slot'])
                else:
                    n.call(0x1495ca,{r.UC_X86_REG_RDI:inv,r.UC_X86_REG_ESI:f['slot'],r.UC_X86_REG_EDX:f['count']},0x1495e0)
                    if mode=='stack':n.call(0x171172,{r.UC_X86_REG_RAX:component,r.UC_X86_REG_ECX:f['counterB2']},0x171179)
        slots=[]
        for i in sorted(known):
            row=slot(inv,i);component=n.q(row+0x10);item=None
            if component:
                n.call(0x72d5fe,{r.UC_X86_REG_R13:row},0x72d610);item_id=n.u.reg_read(r.UC_X86_REG_R12)&0xffffffff
                n.call(0x72d6ca,{r.UC_X86_REG_R13:row},0x72d6cf);count=n.u.reg_read(r.UC_X86_REG_R14)&255
                item={'itemId':item_id,'count':count,'counterB2':struct.unpack('<H',n.u.mem_read(component+0xb2,2))[0]}
            slots.append({'slot':i,'item':item})
        observations.append({'packetKey':event['packetKey'],'entityId':event['entityId'],'time':event['time'],'slots':slots})
    result={'schema':1,'kind':'native-inventory-slot-state','sourceSha256':sha(path.read_bytes()),'preparerSha256':sha(Path(__file__).read_bytes()),
        'records':observations,'originalBlocks':list(n.blocks.values()),'sources':{name:sha(Path(__file__).with_name(name).read_bytes())for name in ['vfx_spawn_native.py','macho.py']},
        'counts':{'events':len(observations),'slotSnapshots':sum(len(e['slots'])for e in observations),'itemDefinitions':len(definitions)},
        'scope':{'ownedStoragePrimitivesExecuted':True,'apiIdentityCountReadersExecuted':True,'completeInventoryRuntimeExecuted':False,'opaqueScalarB4RuntimeVerified':False}}
    (cache/'research/inventory-state-native.json').write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
    print(json.dumps(result['counts']))
if __name__=='__main__':main()
