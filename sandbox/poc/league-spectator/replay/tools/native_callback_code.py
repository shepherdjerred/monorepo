"""Bounded read/execute continuations for modeled platform ABI callbacks.

Only RET is installed; each entry has an owned host boundary hook. Asset data
stays non-executable. This arena does not contain replacement game functions.
"""
import re
import unicorn

START, SIZE, STRIDE = 0x1f000000, 0x1000, 16


class NativeCallbackCode:
    def __init__(self, *args, **kwargs):
        self.native_callback_code = None
        super().__init__(*args, **kwargs)

    def allocate_native_callback(self, label, callback):
        if not isinstance(label, str) or re.fullmatch(r'[a-z0-9:_-]{1,128}', label) is None or not callable(callback):
            raise ValueError('An explicit bounded native ABI callback label and handler are required')
        if self.native_callback_code is None:
            if any(first < START + SIZE and last + 1 > START for first, last, _ in self.u.mem_regions()):
                raise ValueError('Native callback code arena overlaps an existing mapping')
            self.u.mem_map(START, SIZE, unicorn.UC_PROT_READ | unicorn.UC_PROT_EXEC)
            # Host installation writes are outside guest permissions. Unowned
            # slots trap; guest data writes can never modify the callback page.
            self.u.mem_write(START, b'\xcc' * SIZE)
            self.native_callback_code = {'start': START, 'end': START + SIZE,
                                         'guestReadable': True, 'guestExecutable': True,
                                         'guestWritable': False, 'entries': []}
        entries = self.native_callback_code['entries']
        if len(entries) >= SIZE // STRIDE:
            raise ValueError('Native callback code arena capacity exceeded')
        address = START + len(entries) * STRIDE
        self.u.mem_write(address, b'\xc3')
        self.u.hook_add(unicorn.UC_HOOK_CODE, callback, begin=address, end=address)
        entries.append({'address': address, 'label': label, 'bytesHex': 'c3'})
        return address
