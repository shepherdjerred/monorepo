"""Cooperatively dispatch owned asset work before an original synchronous wait.

Game instructions, callback results and readiness fields remain original. The
single emulated context uses a separate, guarded worker stack, then restores the
suspended CPU context. This does not model OS threads or concurrent execution.
"""
import capstone
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES,sha


WAIT=0x1477480
POLL=0x1477528
WORKER_BEGIN=0x10300000
WORKER_TOP=0x10310008
WORKER_END=0x10311000
REGISTERS=[getattr(r,'UC_X86_REG_'+name) for name in
           ['RAX','RBX','RCX','RDX','RSI','RDI','RBP','RSP','R8','R9','R10','R11','R12','R13','R14','R15',
            'RIP','EFLAGS','FS_BASE','GS_BASE']+[f'XMM{i}' for i in range(16)]]


class NativeAssetWaitDispatch:
    def __init__(self,n):
        if n.asset_work_queue is None or n.asset_completion_dispatcher is None:
            raise ValueError('Owned original asset queue and completion dispatcher required')
        if (ADDRESSES['stack']!=0x10010008 or
                any(a<WORKER_END and a+size>WORKER_BEGIN for a,size in n.allocations.items()) or
                any(n.u.mem_read(WORKER_BEGIN,WORKER_END-WORKER_BEGIN))):
            raise ValueError('Separate asset worker stack is not an unused owned region')
        self.n=n;self.active=False;self.worker=False;self.closed=False
        self.wait_hit=None;self.consumed=0;self.limit=0;self.waits=[];self.runs=[]
        self.decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);self.block_counts={}
        self.guard=b'\xa5'*256
        n.u.mem_write(WORKER_BEGIN,self.guard);n.u.mem_write(WORKER_TOP+8,self.guard)
        self.hooks=[n.u.hook_add(unicorn.UC_HOOK_CODE,self.on_wait,begin=n.base+POLL,end=n.base+POLL),
                    n.u.hook_add(unicorn.UC_HOOK_BLOCK,self.on_block)]
        n.u.ctl_remove_cache(n.base+WAIT,n.base+POLL+32)

    def pending(self,state):
        return (any(b['queued'] or b['outstanding'] for b in state['buckets']) or
                any(state[k] for k in ['completionJobs','decodedCallbacks','pendingCallbacks']))

    def on_wait(self,engine,address,size,user):
        if self.worker:
            raise ValueError('Original asset worker reached a nested synchronous wait; dependency scheduling is unresolved')
        if not self.active:return
        n=self.n
        if engine.reg_read(r.UC_X86_REG_R12)!=n.asset_work_queue:
            raise ValueError('Original resource wait selected a different queue')
        state=n.asset_queue_state()
        # The wait has already promoted its target and registered its frame.
        # Ready callbacks belong to this original wait, not to a worker stack.
        if state['decodedCallbacks']:return
        if not any(b['queued'] for b in state['buckets']) and not state['completionJobs']:return
        job=engine.reg_read(r.UC_X86_REG_R14)
        if not n.library_pointer(job,0x58):raise ValueError('Original resource wait has no owned job')
        self.wait_hit={'originalWaitRva':WAIT,'originalPollRva':POLL,'job':job,'before':state,'completed':False}
        engine.emu_stop()

    def on_block(self,engine,address,size,user):
        if self.worker:
            stack=engine.reg_read(r.UC_X86_REG_RSP)
            if not WORKER_BEGIN+256<=stack<=WORKER_TOP:
                raise ValueError('Original asset worker escaped its separate stack bounds')
        if not self.active:return
        key=(address,size) if self.n.base<=address<self.n.base+len(self.n.image) else (address,size,bytes(engine.mem_read(address,size)))
        count=self.block_counts.get(key)
        if count is None:
            data=bytes(engine.mem_read(address,size));instructions=list(self.decoder.disasm_lite(data,address))
            if not instructions or sum(i[1] for i in instructions)!=size:
                raise ValueError('Complete basic-block decoding required for conservative CPU accounting')
            count=len(instructions);self.block_counts[key]=count
        # Count the entire block before executing it. Stops inside a block can
        # overcount, but never grant extra main-call instructions after a wait.
        self.consumed+=count
        if self.consumed>=self.limit:engine.emu_stop()

    def dispatch(self,record):
        n=self.n
        if len(self.waits)>=64:raise ValueError('Original call exceeds 64 owned asset dispatch boundaries')
        self.waits.append(record)
        context=n.u.context_save();registers=[n.u.reg_read(k) for k in REGISTERS]
        main_top=ADDRESSES['stack'];main_begin=main_top-0x10000;main_end=main_top+8
        stack=bytes(n.u.mem_read(main_begin,main_end-main_begin));guard_hooks=[]
        record.update(mainStackSha256=sha(stack),workerStackTop=WORKER_TOP)
        def reject_main_access(engine,access,address,size,value,user):
            raise ValueError('Original asset worker accessed the suspended call stack')
        try:
            self.active=False;self.worker=True;ADDRESSES['stack']=WORKER_TOP
            for mode in [unicorn.UC_HOOK_MEM_READ,unicorn.UC_HOOK_MEM_WRITE]:
                guard_hooks.append(n.u.hook_add(mode,reject_main_access,begin=main_begin,end=main_end-1))
            before=len(n.asset_queue_jobs)
            # Execute one actual dequeue/read and its original decode work.
            # The suspended wait itself invokes the ready game callbacks.
            n.call(0x14785f0,{r.UC_X86_REG_RDI:n.asset_work_queue})
            job=n.u.reg_read(r.UC_X86_REG_RAX)
            if job:
                if not n.library_pointer(job,0x58):raise ValueError('Original asset dequeue returned an unowned job')
                work={'job':job,'headerBeforeHex':bytes(n.u.mem_read(job,0x58)).hex(),
                      'key':n.q(job+8),'completedReadWorker':False}
                n.asset_queue_jobs.append(work)
                if not work['key']:raise ValueError('Archive-index waits require the original archive-worker branch')
                n.call(0x1478b80,{r.UC_X86_REG_RDI:n.asset_work_queue,r.UC_X86_REG_RSI:job})
                work.update(completedReadWorker=True,headerAfterHex=bytes(n.u.mem_read(job,0x58)).hex())
            completion=n.drain_asset_completions()
            record['readJobsDispatched']=len(n.asset_queue_jobs)-before
            record['after']=n.asset_queue_state()
            record['completionJobsDispatched']=completion['queuedBefore']
            record['gameCallbacksDispatchedByWorker']=False
            if not record['readJobsDispatched'] and not record['completionJobsDispatched']:
                raise ValueError('Cooperative dispatch executed no original read or decode work')
            if (bytes(n.u.mem_read(WORKER_BEGIN,256))!=self.guard or
                    bytes(n.u.mem_read(WORKER_TOP+8,256))!=self.guard):
                raise ValueError('Original asset worker changed a separate stack guard')
            record['workerGuardsIntact']=True
        except Exception as error:
            record['boundary']={'kind':type(error).__name__,'message':str(error),
                                'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
            raise
        finally:
            for hook in guard_hooks:n.u.hook_del(hook)
            ADDRESSES['stack']=main_top;self.worker=False;n.u.context_restore(context)
            if (bytes(n.u.mem_read(main_begin,main_end-main_begin))!=stack or
                    [n.u.reg_read(k) for k in REGISTERS]!=registers):
                raise ValueError('Asset dispatch did not preserve the suspended stack and CPU context')
            record['suspendedStackAndRegistersPreserved']=True
        record['completed']=True

    def run(self,start,stop,instruction_bound=5000000):
        if self.closed or self.active or self.worker or not 0<instruction_bound<=5000000:
            raise ValueError('Invalid bounded cooperative asset execution')
        n=self.n;remaining=instruction_bound
        record={'instructionBound':instruction_bound,'conservativeMainInstructions':0,'completed':False}
        self.runs.append(record)
        try:
            while remaining>0:
                self.active=True;self.wait_hit=None;self.consumed=0;self.limit=remaining
                n.u.emu_start(start,stop,count=remaining)
                self.active=False;used=min(remaining,self.consumed)
                if not used:raise ValueError('Native call executed without conservative basic-block accounting')
                remaining-=used;record['conservativeMainInstructions']+=used
                start=n.u.reg_read(r.UC_X86_REG_RIP)
                if start==stop:record['completed']=True;return start
                if self.wait_hit is None:return start
                if start!=n.base+POLL:raise ValueError('Original wait did not stop at its observed poll boundary')
                if remaining<=0:return start
                self.dispatch(self.wait_hit)
            return start
        finally:self.active=False

    def call(self,entry,registers):
        n=self.n;n.u.context_restore(n.initial);n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        n.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack'])
        for key,value in registers.items():n.u.reg_write(key,value)
        start=n.base+entry
        for _ in range(16):
            start=self.run(start,ADDRESSES['stop'])
            if start==ADDRESSES['stop']:return
        raise ValueError('Original resource wait call exceeds sixteen bounded CPU slices')

    def close(self):
        if not self.closed:
            for hook in self.hooks:self.n.u.hook_del(hook)
            self.closed=True
