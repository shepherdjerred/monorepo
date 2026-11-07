"""Owned asset-queue data and explicit original I/O job dispatch.

The independent original data initialization executes. Its OS thread creation
does not execute and is never reported successful. The caller can inspect and
drain queued reads using original dequeue/worker functions. Native completion
callbacks and any further scheduler dependencies remain original.
"""
from unicorn import x86_const as r
from shared_particle_resources_native import NativeSharedParticleResources
from vfx_object_native import TASK_VALUE,TASK_ID
from graphics_block_texture_device import GraphicsBlockTextureDevice,FORMATS
from native_block_texture_upload import upload_block_texture
from vfx_spawn_native import ADDRESSES


class NativeAssetWorkQueue(NativeSharedParticleResources):
    def __init__(self,*args):
        self.asset_work_queue = None
        self.asset_semaphores,self.asset_queue_platform_calls = {},[]
        self.asset_queue_jobs = []
        self.asset_completion_dispatcher = None
        self.asset_completion_runs = []
        self.asset_callback_runs = []
        self.block_texture_backend = None
        super().__init__(*args)
        if self.source.data_imports.get(0x22e03f8) != '_mach_task_self_':
            raise ValueError('Asset queue task data import differs')

    def initialize_character_graphics(self,angle):
        state = super().initialize_character_graphics(angle)
        self.block_texture_backend = GraphicsBlockTextureDevice(self.device,self.image)
        # Original static initialization for the resource-invalidation mutex
        # and its empty listener map. Completion callbacks use both; no native
        # notifications are skipped and no listener is invented.
        mutex = self.base+0x256e110
        listeners = self.base+0x256e150
        if mutex in self.mutexes or any(self.u.mem_read(listeners,0x28)):
            raise ValueError('Texture invalidation state is not cold')
        self.call(0x191d0e5,{},0x191d0f3)
        self.call(0x191d110,{},0x191d132)
        if mutex not in self.mutexes or self.mutexes[mutex] or self.u32(listeners+0x20)!=0x3f800000:
            raise ValueError('Original texture invalidation initialization differs')
        state['textureInvalidation'] = {'mutex':mutex,'listeners':listeners,
            'originalInitializationBlocks':[[0x191d0e5,0x191d0f3],[0x191d110,0x191d132]],
            'fullStaticConstructorExecuted':False}
        return state

    def graphics_call(self,uc,address,size,kind):
        if kind in ['2d','array','cube'] and uc.reg_read(r.UC_X86_REG_ESI) in FORMATS:
            if self.block_texture_backend is None:raise ValueError('Compressed texture backend is absent')
            return upload_block_texture(self,uc,kind)
        return super().graphics_call(uc,address,size,kind)

    def close_graphics(self):
        if self.block_texture_backend is not None:self.block_texture_backend.close()
        super().close_graphics()

    def imported(self,uc,address,size,user):
        name = self.source.imports[address-self.base]
        first,second,third,fourth = [uc.reg_read(reg) for reg in
            [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX,r.UC_X86_REG_RCX]]
        destinations = ([self.asset_work_queue+0xc] if self.asset_work_queue is not None else []) + (
            [self.asset_completion_dispatcher+0x60,self.asset_completion_dispatcher+0x64] if self.asset_completion_dispatcher is not None else [])
        if name == '_semaphore_create' and second in destinations:
            if first != TASK_ID or third != 0 or fourth != 0 or any(s['destination'] == second for s in self.asset_semaphores.values()):
                raise ValueError('Asset queue semaphore creation escaped its owned ABI')
            token = 0x71000001+len(self.asset_semaphores)
            self.asset_semaphores[token] = {'destination':second,'count':fourth}
            self.put(second,'I',token)
            self.asset_queue_platform_calls.append({'name':name,'token':token,'initialCount':fourth})
            uc.reg_write(r.UC_X86_REG_RAX,0)
            self.ret()
            return
        if name in ['_semaphore_signal','_semaphore_wait'] and first in self.asset_semaphores:
            semaphore = self.asset_semaphores[first]
            if name == '_semaphore_signal':
                if semaphore['count'] >= 65536:raise ValueError('Asset queue wakeup count exceeds bound')
                semaphore['count'] += 1
            else:
                if not semaphore['count']:
                    raise ValueError('Asset queue semaphore would block; no OS worker is running')
                semaphore['count'] -= 1
            self.asset_queue_platform_calls.append({'name':name,'token':first,'count':semaphore['count']})
            uc.reg_write(r.UC_X86_REG_RAX,0)
            self.ret()
            return
        return super().imported(uc,address,size,user)

    def initialize_asset_work_queue(self):
        if self.asset_work_queue is not None or self.q(self.base+0x2470d68):
            raise ValueError('Original asset queue already exists')
        # Bind after restoring fixture data pages. This is the existing opaque
        # single-process task ABI, not a game readiness value.
        self.put(self.base+0x22e03f8,'Q',TASK_VALUE)
        self.put(TASK_VALUE,'I',TASK_ID)
        self.asset_work_queue = self.allocate(0x130)
        # Stop after all independent queue/mutex/semaphore/active-flag fields,
        # before constructing a thread name or invoking the thread factory.
        self.call(0x14767f0,{r.UC_X86_REG_RDI:self.asset_work_queue},0x14768c3)
        if (self.q(self.base+0x2470d68) != self.asset_work_queue or
                self.q(self.asset_work_queue+0x10) or len(self.asset_semaphores) != 1):
            raise ValueError('Original queue data publication differs')
        return {'object':self.asset_work_queue,'originalDataInitializationBlock':[0x14767f0,0x14768c3],
                'fullConstructorExecuted':False,'osWorkerThreadCreated':False,'workerCreationReportedSuccessful':False,
                'dataHex':bytes(self.u.mem_read(self.asset_work_queue,0x130)).hex(),
                'scope':{'callerOwnsDispatch':True,'resourceReadinessVerified':False,'liveWorldRoutingVerified':False}}

    def asset_queue_state(self):
        if self.asset_work_queue is None:raise ValueError('Owned asset queue is absent')
        queue = self.asset_work_queue
        buckets = []
        for i in range(3):
            count,capacity = self.u32(queue+0x88+i*24),self.u32(queue+0x8c+i*24)
            pointer = self.q(queue+0x80+i*24)
            if count > 65536 or count > capacity or count and not self.library_pointer(pointer,count*8):
                raise ValueError('Original asset queue bucket escaped owned bounds')
            buckets.append({'priority':i,'outstanding':self.u32(queue+0x78+i*24),
                            'queued':count,'capacity':capacity,'pointer':pointer})
        return {'object':queue,'buckets':buckets,'semaphores':{k:dict(v) for k,v in self.asset_semaphores.items()},
                'threadObject':self.q(queue+0x10),
                'completionJobs':self.u32(self.asset_completion_dispatcher+0x58) if self.asset_completion_dispatcher else None,
                'decodedCallbacks':self.u32(queue+0xd8),'pendingCallbacks':self.u32(queue+0xe8)}

    def initialize_asset_completion_dispatcher(self,worker_count):
        if self.asset_completion_dispatcher is not None or self.q(self.base+0x2477f70) or not 1 <= worker_count <= 8:
            raise ValueError('A cold completion dispatcher and explicit bounded worker-count input required')
        self.asset_completion_dispatcher = self.allocate(0x80)
        # With a nonzero caller input, the original constructor skips its
        # platform CPU-count query. Stop after data, mutex, semaphore and list
        # initialization, before reserve/worker-object/thread creation.
        self.call(0x142c130,{r.UC_X86_REG_RDI:self.asset_completion_dispatcher,r.UC_X86_REG_RSI:worker_count},0x142c1ed)
        if (self.q(self.base+0x2477f70) != self.asset_completion_dispatcher or
                self.u32(self.asset_completion_dispatcher+8) != worker_count or self.u32(self.asset_completion_dispatcher+0x78)):
            raise ValueError('Original completion data publication differs')
        return {'object':self.asset_completion_dispatcher,'originalDataInitializationBlock':[0x142c130,0x142c1ed],
                'requestedWorkerCountInput':worker_count,'workerThreadsCreated':0,'fullConstructorExecuted':False,
                'platformCpuCountRecovered':False,'callerOwnsDispatch':True}

    def drain_asset_completions(self):
        if self.asset_completion_dispatcher is None:raise ValueError('Owned completion dispatcher is absent')
        count = self.u32(self.asset_completion_dispatcher+0x58)
        if count > 1024:raise ValueError('Completion drain exceeds explicit job bound')
        record = {'queuedBefore':count,'originalWorkerLoopRva':0x142ccd0,'stopBeforeWaitRva':0x142cd50,'completed':False,'slices':[]}
        self.asset_completion_runs.append(record)
        # Several original Zstd/texture decodes can exceed one CPU slice.
        # Retain the exact original stack and registers across bounded slices;
        # no callback is restarted and decoding is not replaced by a stub.
        self.u.context_restore(self.initial)
        self.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        self.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack'])
        start,stop = self.base+0x142ccd0,self.base+0x142cd50
        self.u.ctl_remove_cache(start,stop)
        for index in range(16):
            self.u.emu_start(start,stop,count=5000000)
            start = self.u.reg_read(r.UC_X86_REG_RIP)
            record['slices'].append({'slice':index+1,'instructionBound':5000000,'stop':start,
                'completionJobs':self.u32(self.asset_completion_dispatcher+0x58),
                'decodedCallbacks':self.u32(self.asset_work_queue+0xd8)})
            if start == stop:break
        else:raise ValueError('Original completion decoding exceeds sixteen bounded CPU slices')
        remaining = self.u32(self.asset_completion_dispatcher+0x58)
        if remaining:raise ValueError('Original completion worker reached idle with jobs remaining')
        record.update(completed=True,queuedAfter=remaining)
        return record

    def drain_asset_callbacks(self):
        if self.asset_work_queue is None:raise ValueError('Owned asset queue is absent')
        record = {'before':self.asset_queue_state(),'originalCallbackDispatcherRva':0x1477fa0,
                  'timeBudgetInput':0xffffffff,'completed':False}
        self.asset_callback_runs.append(record)
        # These are the original success/error/cancellation callbacks, queue
        # counter updates, ID retirement and resource destruction. The large
        # explicit preparation budget does not supply a game readiness flag.
        self.call(0x1477fa0,{r.UC_X86_REG_RDI:self.asset_work_queue,r.UC_X86_REG_RSI:0xffffffff})
        record.update(completed=True,after=self.asset_queue_state())
        return record

    def consume_asset_wakeups(self):
        for semaphore in self.asset_semaphores.values():
            while semaphore['count']:
                self.call(0x142b720,{r.UC_X86_REG_RDI:semaphore['destination']})

    def drain_asset_read_jobs(self):
        if self.asset_work_queue is None:raise ValueError('Owned asset queue is absent')
        for _ in range(1024):
            self.call(0x14785f0,{r.UC_X86_REG_RDI:self.asset_work_queue})
            job = self.u.reg_read(r.UC_X86_REG_RAX)
            if not job:
                self.drain_asset_completions()
                self.drain_asset_callbacks()
                self.consume_asset_wakeups()
                state = self.asset_queue_state()
                if any(bucket['queued'] for bucket in state['buckets']):continue
                if (any(bucket['outstanding'] for bucket in state['buckets']) or
                        any(state[key] for key in ['completionJobs','decodedCallbacks','pendingCallbacks'])):
                    raise ValueError('Asset dispatch reached idle with outstanding original jobs/callbacks')
                return self.asset_queue_jobs
            if not self.library_pointer(job,0x58):raise ValueError('Original asset dequeue returned an unowned job')
            record = {'job':job,'headerBeforeHex':bytes(self.u.mem_read(job,0x58)).hex(),
                      'key':self.q(job+8),'completedReadWorker':False}
            self.asset_queue_jobs.append(record)
            if not record['key']:
                raise ValueError('Archive-index queue jobs require the original archive-worker branch')
            self.call(0x1478b80,{r.UC_X86_REG_RDI:self.asset_work_queue,r.UC_X86_REG_RSI:job})
            record.update(completedReadWorker=True,headerAfterHex=bytes(self.u.mem_read(job,0x58)).hex())
        raise ValueError('Asset read drain exceeds 1024 original jobs')
