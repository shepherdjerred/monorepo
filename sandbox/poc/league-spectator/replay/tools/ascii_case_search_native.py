"""Bounded ASCII strcasestr platform ABI; non-ASCII locale behavior is unadmitted."""
from unicorn import x86_const as r
from vfx_spawn_native import sha

STRCASESTR_RVA = 0x1feeda4


class NativeAsciiCaseSearch:
    def __init__(self, *args, **kwargs):
        self.ascii_case_search_calls = []
        super().__init__(*args, **kwargs)
        if self.source.imports.get(STRCASESTR_RVA) != '_strcasestr':
            raise ValueError('Original strcasestr platform import differs')

    def imported(self, engine, address, size, user):
        if address - self.base != STRCASESTR_RVA:
            return super().imported(engine, address, size, user)
        haystack_pointer, needle_pointer = [engine.reg_read(register) for register in
                                           [r.UC_X86_REG_RDI, r.UC_X86_REG_RSI]]
        # The shared owned C-string reader requires a terminator within 4096
        # bytes. This admits ASCII folding only; no Unicode conversion or
        # non-ASCII locale behavior is substituted.
        haystack, needle = self.cstring(haystack_pointer), self.cstring(needle_pointer)
        if any(value >= 128 for value in haystack + needle):
            raise ValueError('Non-ASCII strcasestr requires recovered locale behavior')
        offset = haystack.lower().find(needle.lower())
        result = haystack_pointer + offset if offset >= 0 else 0
        self.ascii_case_search_calls.append({
            'callerRva': self.q(engine.reg_read(r.UC_X86_REG_RSP)) - self.base,
            'haystackBytes': len(haystack), 'needleBytes': len(needle),
            'haystackSha256': sha(haystack), 'needleSha256': sha(needle),
            'matchOffset': offset if offset >= 0 else None,
            'platformLibraryBoundary': True, 'asciiOnly': True})
        engine.reg_write(r.UC_X86_REG_RAX, result)
        self.ret()
