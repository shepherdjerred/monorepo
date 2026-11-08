"""Explicit platform entropy for the original libc++ random_device ABI.

These are client-process entropy inputs, never recovered replay/effect seeds.
Supplied words support repeatable controls; real startup uses host OS entropy.
"""
import os
from unicorn import x86_const as r
from libcpp_concat_native import read_libcpp_string


class NativeRandomDeviceInputs:
    def __init__(self, *args, **kwargs):
        self.random_device_policy = None
        self.random_device_words = []
        self.random_device_cursor = 0
        self.random_device_objects = {}
        self.random_device_calls = []
        super().__init__(*args, **kwargs)
        expected = {0x1fee456: '__ZNSt3__113random_deviceC1ERKNS_12basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEEE',
                    0x1fee45c: '__ZNSt3__113random_deviceD1Ev', 0x1fee462: '__ZNSt3__113random_deviceclEv'}
        if any(self.source.imports.get(at) != name for at, name in expected.items()):
            raise ValueError('Original libc++ random_device imports differ')

    def configure_random_device_inputs(self, policy, words=None):
        if self.random_device_policy is not None or policy not in ['host-os-entropy', 'supplied-uint32-control']:
            raise ValueError('One explicit platform entropy policy required')
        if policy == 'host-os-entropy' and words is not None or policy == 'supplied-uint32-control' and (
                not isinstance(words, list) or not 0 < len(words) <= 4096 or
                any(type(word) is not int or not 0 <= word <= 0xffffffff for word in words)):
            raise ValueError('Explicit bounded platform entropy inputs required')
        self.random_device_policy = policy
        self.random_device_words = list(words or [])
        return {'policy': policy, 'replaySeedsRecovered': False, 'effectSeedsRecovered': False}

    def imported(self, engine, address, size, user):
        at = address - self.base
        if at not in [0x1fee456, 0x1fee45c, 0x1fee462]:
            return super().imported(engine, address, size, user)
        target = engine.reg_read(r.UC_X86_REG_RDI)
        if self.random_device_policy is None or not self.writable_file_memory(target, 4):
            raise ValueError('Configured platform entropy and owned random_device storage required')
        if at == 0x1fee456:
            token = read_libcpp_string(self, engine.reg_read(r.UC_X86_REG_RSI))
            if token != b'/dev/urandom' or target in self.random_device_objects and self.random_device_objects[target]['live']:
                raise ValueError('Original random_device token or object lifecycle is unsupported')
            identity = len(self.random_device_calls) + 1
            self.put(target, 'I', identity)
            self.random_device_objects[target] = {'identity': identity, 'live': True}
            result, operation = 0, 'construct'
        else:
            state = self.random_device_objects.get(target)
            if state is None or not state['live'] or self.u32(target) != state['identity']:
                raise ValueError('Owned live random_device required')
            if at == 0x1fee45c:
                state['live'] = False
                result, operation = 0, 'destroy'
            else:
                if self.random_device_cursor >= 4096:
                    raise ValueError('Platform entropy requests exceeded the explicit control bound')
                if self.random_device_policy == 'supplied-uint32-control':
                    if self.random_device_cursor >= len(self.random_device_words):
                        raise ValueError('Supplied platform entropy transcript exhausted')
                    result = self.random_device_words[self.random_device_cursor]
                else:
                    result = int.from_bytes(os.urandom(4), 'little')
                self.random_device_cursor += 1
                operation = 'sample'
        self.random_device_calls.append({'operation': operation, 'object': target, 'result': result,
            'policy': self.random_device_policy, 'replaySeedRecovered': False})
        engine.reg_write(r.UC_X86_REG_RAX, result)
        self.ret()
