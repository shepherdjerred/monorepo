"""Allow the original actor service to decode real installed item libraries."""
import json
from original_call_slices_native import call_original_sliced


class NativeActorServiceSlices:
    def __init__(self, *args, **kwargs):
        self.actor_service_execution = None
        super().__init__(*args, **kwargs)

    def call(self, entry, registers, end=None):
        if entry != 0x677f30 or end is not None:
            return super().call(entry, registers, end)
        if self.actor_service_execution is not None:
            raise ValueError('Actor service initialization must remain one original call')
        self.actor_service_execution = {}
        call_original_sliced(self, entry, registers, self.actor_service_execution,
            on_slice=lambda row: print(json.dumps({'phase': 'actor-service', **row}), flush=True))
