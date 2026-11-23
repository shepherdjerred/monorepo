import copy
import unittest
from original_asset_dispatch_native import initialize_original_asset_dispatch


class Fake:
    def __init__(self):
        self.base, self.owner = 0x100000000, 8192
        self.asset_completion_dispatcher = None
        self.allocations = {self.owner: 0x80}
        self.memory = {self.base+0x2477f70: self.owner, self.owner: self.base+0x23dd6f0,
                       self.owner+8: 8, self.owner+0x70: 16384, self.owner+0x78: 8,
                       self.owner+0x60: 1, self.owner+0x64: 2}
        self.mach_semaphores = {1: {'destroyed': False, 'count': 0}, 2: {'destroyed': False, 'count': 0}}
        self.blocks = {0: {'rva': 0x142c130}}
        self.calls = []

    def initialize_asset_work_queue(self):
        self.calls.append('original-queue')
        return {'object': 24576}

    def initialize_asset_completion_dispatcher(self, count):
        self.calls.append(('original-cold-completion', count))
        return {'object': 32768}

    def q(self, pointer):
        return self.memory[pointer]

    def u32(self, pointer):
        return self.memory[pointer]

    def library_pointer(self, pointer, size):
        return (pointer, size) == (16384, 64)


class Controls(unittest.TestCase):
    def test_existing_native_owner_is_associated_without_native_state_changes(self):
        n = Fake()
        before = copy.deepcopy((n.memory, n.mach_semaphores, n.allocations))
        result = initialize_original_asset_dispatch(n)
        self.assertEqual(n.asset_completion_dispatcher, 8192)
        self.assertEqual(result['completion']['workerCount'], 8)
        self.assertTrue(result['completion']['existingOriginalOwnerRetained'])
        self.assertFalse(result['completion']['osWorkerExecutionClaimed'])
        self.assertEqual(n.calls, ['original-queue'])
        self.assertEqual((n.memory, n.mach_semaphores, n.allocations), before)

    def test_bad_class_allocation_workers_vector_or_semaphores_cannot_bind(self):
        for change in ['class', 'allocation', 'workers', 'vector-count', 'vector-storage', 'semaphore']:
            n = Fake()
            if change == 'class':
                n.memory[n.owner] += 1
            if change == 'allocation':
                n.allocations[n.owner] = 0x70
            if change == 'workers':
                n.memory[n.owner+8] = 9
            if change == 'vector-count':
                n.memory[n.owner+0x78] = 9
            if change == 'vector-storage':
                n.memory[n.owner+0x70] += 1
            if change == 'semaphore':
                n.mach_semaphores[2]['destroyed'] = True
            before = copy.deepcopy((n.memory, n.mach_semaphores, n.allocations))
            with self.assertRaises(ValueError):
                initialize_original_asset_dispatch(n)
            self.assertIsNone(n.asset_completion_dispatcher)
            self.assertEqual((n.memory, n.mach_semaphores, n.allocations), before)
            self.assertEqual(n.calls, ['original-queue'])

    def test_absent_owner_uses_existing_original_data_constructor(self):
        n = Fake()
        n.memory[n.base+0x2477f70] = 0
        result = initialize_original_asset_dispatch(n)
        self.assertEqual(n.calls, ['original-queue', ('original-cold-completion', 1)])
        self.assertEqual(result['completion']['object'], 32768)


if __name__ == '__main__':
    unittest.main()
