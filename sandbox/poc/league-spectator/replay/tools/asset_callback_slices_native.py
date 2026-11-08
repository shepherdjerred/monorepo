"""Retain the original asset callback frame across bounded CPU slices."""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


class NativeAssetCallbackSlices:
    def drain_asset_callbacks(self):
        if self.asset_work_queue is None:raise ValueError('Owned asset queue is absent')
        record={'before':self.asset_queue_state(),'originalCallbackDispatcherRva':0x1477fa0,
                'timeBudgetInput':0xffffffff,'completed':False,'sliceInstructionBound':5000000,
                'sliceCountBound':16,'slices':[]}
        self.asset_callback_runs.append(record)
        self.u.context_restore(self.initial);self.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        for register,value in {r.UC_X86_REG_RSP:ADDRESSES['stack'],r.UC_X86_REG_RDI:self.asset_work_queue,
                               r.UC_X86_REG_RSI:0xffffffff}.items():self.u.reg_write(register,value)
        start=self.base+0x1477fa0
        for i in range(16):
            # Callbacks can perform substantial original animation processing.
            # Continue the same stack/registers; never restart a partial callback
            # or substitute its completion/result. The total bound stays finite.
            self.u.emu_start(start,ADDRESSES['stop'],count=5000000)
            start=self.u.reg_read(r.UC_X86_REG_RIP)
            record['slices'].append({'slice':i+1,'stop':start,'state':self.asset_queue_state()})
            if start==ADDRESSES['stop']:
                record.update(completed=True,after=self.asset_queue_state())
                return record
        raise ValueError('Original asset callbacks exceed sixteen bounded CPU slices')
