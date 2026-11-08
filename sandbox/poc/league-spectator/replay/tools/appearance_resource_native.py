"""Original appearance projection over an explicit prepared resource cache.

Cache keys are initialized by original constructors/key-copy instructions. Full
asset loading/readiness is excluded. No unit/team/appearance callback is faked;
the projection input explicitly has no local player and no alternate forms.
"""
from unicorn import x86_const as r
from appearance_stack_native import NativeAppearanceStackInputs
from vfx_spawn_native import ADDRESSES

FRAME = 0x100f5000
CACHE = 0x255ce80
LOCAL_PLAYER = 0x2470b70


class NativeAppearanceResources(NativeAppearanceStackInputs):
    def allocate_text(self, value):
        encoded = value.encode('utf-8')+b'\0'
        if len(encoded) > 4097 or b'\0' in encoded[:-1]:
            raise ValueError('Bounded appearance string required')
        at = self.allocate(len(encoded))
        self.u.mem_write(at, encoded)
        return at

    def prepare_cache(self, entries):
        if not entries:
            raise ValueError('Explicit nonempty prepared cache required')
        objects, keys = [], set()
        for entry in entries:
            key = (entry['name'],entry['namespace'],entry['skinId'],entry['keyFlags'])
            if key in keys:
                raise ValueError('Prepared appearance cache keys must be unique')
            keys.add(key)
            obj = self.allocate(0x170)
            self.call(0x2a6000, {r.UC_X86_REG_RDI:obj})
            self.u.mem_write(FRAME-0x100,bytes(0x100))
            self.put(FRAME-0x60,'Q',obj)
            self.put(FRAME-0x50,'Q',self.allocate_text(entry['name']))
            self.put(FRAME-0x58,'Q',self.allocate_text(entry['namespace']))
            self.put(FRAME-0x44,'I',entry['skinId'])
            self.put(FRAME-0x48,'I',entry['keyFlags'])
            self.call(0x2a68ee,{r.UC_X86_REG_RBP:FRAME},0x2a692a)
            self.put(obj+0x20,'Q',entry['context'])
            objects.append({**entry,'object':obj})
        table = self.allocate(len(objects)*8)
        for i,obj in enumerate(objects):
            self.put(table+i*8,'Q',obj['object'])
        self.put(self.base+CACHE,'QII',table,len(objects),len(objects))
        self.prepared_appearance_cache = objects
        return objects

    def appearance_stack(self, name, skin, namespace=''):
        stack = self.allocate(0x130)
        self.call(0x66230,{r.UC_X86_REG_RDI:stack,r.UC_X86_REG_RSI:0})
        for offset,text in [(0x18,name),(0x28,namespace)]:
            self.call(0x14c3790,{r.UC_X86_REG_RDI:stack+offset,r.UC_X86_REG_RSI:self.allocate_text(text)})
        self.put(stack+0x38,'I',skin)
        return stack

    def push_storage(self, stack, event):
        if (event['opcode'] != 984 or event['preloadFlag'] or event['modifierNames'] or
                event['strings']['alternateCharacterA'] or event['strings']['alternateCharacterB']):
            raise ValueError('Explicit no-preload empty-modifier/alternate push required')
        vector = self.allocate(16)
        self.call(0x67120,{r.UC_X86_REG_RDI:stack,r.UC_X86_REG_RSI:vector})
        strings = {key:self.allocate_text(value) for key,value in event['strings'].items()}
        arguments = [event['flagStack0'],event['preloadFlag'],event['flagStack2'],event['flagStack3'],
                     event['gearIndex'],strings['alternateCharacterA'],event['alternateSkinA'],
                     strings['alternateCharacterB'],event['alternateSkinB'],0,event['overrideMask'],strings['namespace']]
        for i,value in enumerate(arguments):
            self.put(ADDRESSES['stack']+8+i*8,'Q',int(value))
        self.call(0x66310,{r.UC_X86_REG_RDI:stack,r.UC_X86_REG_RSI:strings['character'],
                          r.UC_X86_REG_RDX:event['skinId'],r.UC_X86_REG_RCX:event['entryId'],
                          r.UC_X86_REG_R8:int(event['flagR8']),r.UC_X86_REG_R9:int(event['flagR9'])},0x667f1)

    def project(self, stack, expect_cache_miss=False):
        if self.q(self.base+LOCAL_PLAYER):
            raise ValueError('This projection control requires an explicitly absent local player')
        out = self.allocate(0x70)
        for i,offset in enumerate([0x28,0x40,0x50]):
            self.put(ADDRESSES['stack']+8+i*8,'Q',out+offset)
        self.call(0x67330,{r.UC_X86_REG_RDI:stack,r.UC_X86_REG_RSI:out,r.UC_X86_REG_RDX:out+8,
                          r.UC_X86_REG_RCX:out+0x10,r.UC_X86_REG_R8:out+0x18,r.UC_X86_REG_R9:out+0x20},
                  0x2a91af if expect_cache_miss else None)
        if expect_cache_miss:
            return {'status':'unprepared-cache-key','stack':stack}
        lookup = {x['object']:x for x in self.prepared_appearance_cache}
        selected = [self.q(out+i*8) for i in range(6)]
        if any(value and value not in lookup for value in selected):
            raise ValueError('Original projection selected an unprepared cache object')
        return {'objects':selected,'keys':[None if not value else
                    {key:lookup[value][key] for key in ['name','namespace','skinId','keyFlags','context']} for value in selected],
                'gearIndex':self.u.mem_read(out+0x40,1)[0], 'modifierCount':self.u32(out+0x58),
                'outputs':out}

    def stack_input(self, stack):
        def entry(at):
            return {'key':{'name':self.cstring(self.q(at)).decode('utf-8'),
                           'namespace':self.cstring(self.q(at+0x10)).decode('utf-8'),
                           'skinId':self.u32(at+0x20),'keyFlags':self.u32(at+0x24)},
                    'flags':[bool(x) for x in self.u.mem_read(at+0x78,5)],
                    'gearIndex':self.u.mem_read(at+0x84,1)[0],
                    'modifierNames':[self.cstring(self.q(self.q(at+0x88)+i*16)).decode('utf-8')
                                     for i in range(self.u32(at+0x90))],
                    'alternateCharacterA':self.cstring(self.q(at+0x28)).decode('utf-8'),
                    'alternateCharacterB':self.cstring(self.q(at+0x50)).decode('utf-8')}
        return {'localPlayer':'absent','defaultEntry':entry(stack+0x18),
                'entries':[entry(at) for at in range(self.q(stack),self.q(stack+8),0xa0)]}
