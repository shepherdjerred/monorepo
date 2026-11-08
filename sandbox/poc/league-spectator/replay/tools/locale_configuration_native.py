"""Original locale construction and archive-name getters over supplied inputs."""
import re
from unicorn import x86_const as r


class NativeLocaleCaseConversion:
    def __init__(self, *args, **kwargs):
        self.locale_upper_calls = []
        super().__init__(*args, **kwargs)
        if self.source.imports.get(0x1fee690) != '___toupper':
            raise ValueError('Exact locale uppercase import differs')

    def imported(self, engine, address, size, user):
        if address - self.base != 0x1fee690:
            return super().imported(engine, address, size, user)
        value = engine.reg_read(r.UC_X86_REG_EDI)
        if value != 0xffffffff and value > 127:
            raise ValueError('Locale uppercase bridge admits ASCII or EOF only')
        result = value - 32 if 97 <= value <= 122 else value
        self.locale_upper_calls.append({'input': value, 'result': result})
        engine.reg_write(r.UC_X86_REG_EAX, result)
        self.ret()


def initialize_locale_configuration(n, locale=''):
    if not isinstance(locale, str) or locale and re.fullmatch(r'[a-z]{2}_[A-Z]{2}', locale) is None:
        raise ValueError('A supplied ASCII locale identifier or the original empty/default input is required')
    if n.q(n.base + 0x246d558):
        raise ValueError('Original locale configuration must be cold')
    source = n.allocate(16)
    n.call(0x14c2d60, {r.UC_X86_REG_RDI: source, r.UC_X86_REG_RSI: n.allocate_text(locale)})
    obj = n.allocate(0x170)
    n.u.mem_write(obj + 0x70, b'\xa5' * 0x100)
    n.call(0x160ba00, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: source})
    if n.q(n.base + 0x246d558) != obj or n.q(obj) != n.base + 0x23e7d80:
        raise ValueError('Original locale constructor publication/class differs')
    if bytes(n.u.mem_read(obj + 0x70, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Original locale construction escaped its owned object')
    names = {'locale': n.cstring(n.q(obj + 8)).decode('ascii'),
             'archiveFallbackLocale': n.cstring(n.q(obj + 0x28)).decode('ascii')}
    for name, entry in [('archiveLocale', 0x621d30), ('primaryLocale', 0x621e20)]:
        n.call(entry, {})
        names[name] = n.cstring(n.u.reg_read(r.UC_X86_REG_RAX)).decode('ascii')
    return {'object': obj, 'objectBytes': 0x70, 'guardBytes': 0x100,
            'constructorRva': 0x160ba00, 'globalRva': 0x246d558,
            'archiveGetterRva': 0x621d30, 'primaryGetterRva': 0x621e20,
            'suppliedLocale': locale, **names,
            'replacementPairs': n.u32(obj + 0x40),
            'localeFlags': list(n.u.mem_read(obj + 0x68, 7)),
            'headerHex': bytes(n.u.mem_read(obj, 0x70)).hex(),
            'scope': {'completeOriginalConstructorAndGetters': True,
                      'hostAssignedLocaleFields': False, 'replayLocaleRecovered': False,
                      'mainViewerExpanded': False}}
