"""Bounded C-stdio overlay for original configuration output, never source writes."""
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import sha


MAXIMUM = 1024*1024
LOGICAL = 'data/cfg/game.cfg'


def configure_original_configuration_overlay(n, fixture):
    if getattr(n, 'configuration_overlay', None) is not None or n.client_loose_root is None:
        raise ValueError('One explicit original configuration overlay/source root required')
    root = n.client_loose_root.resolve(strict=True)
    physical = (root/'data/cfg/game.cfg').resolve()
    if not physical.is_relative_to(root) or physical.exists() != physical.is_file():
        raise ValueError('Original configuration source escaped its immutable regular-file root')
    present = physical.is_file()
    if present and physical.stat().st_size > MAXIMUM:
        raise ValueError('Original configuration input exceeds bounded overlay size')
    raw = fixture.raw(physical) if present else None
    n.configuration_overlay = {'physicalSource': str(physical), 'sourcePresent': present,
        'sourceSha256': sha(raw) if raw is not None else None, 'content': bytearray(raw) if raw is not None else None,
        'handles': {}, 'calls': [], 'transferredBytes': 0}


def original_configuration_overlay_summary(n):
    state = n.configuration_overlay
    source = Path(state['physicalSource'])
    if source.is_file() != state['sourcePresent'] or source.exists() != source.is_file():
        raise ValueError('Immutable original configuration source presence changed')
    if source.is_file() and sha(source.read_bytes()) != state['sourceSha256']:
        raise ValueError('Immutable original configuration source bytes changed')
    data = state['content']
    return {'logicalPath': LOGICAL, 'physicalSource': state['physicalSource'],
            'sourcePresent': state['sourcePresent'], 'sourceSha256': state['sourceSha256'],
            'outputBytes': len(data) if data is not None else None,
            'outputSha256': sha(data) if data is not None else None,
            'outputHex': data.hex() if data is not None else None,
            'calls': state['calls'], 'openHandles': list(state['handles']),
            'hostWritesExecuted': False, 'portOwnedOutputOnly': True}


class NativeConfigurationFileOverlay:
    def imported(self, engine, address, size, user):
        state = getattr(self, 'configuration_overlay', None)
        if state is None:
            return super().imported(engine, address, size, user)
        name = self.source.imports[address-self.base]
        args = [engine.reg_read(reg) for reg in
                [r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX, r.UC_X86_REG_RCX]]
        record = None
        if name == '_fopen':
            logical = self.cstring(args[0]).decode('utf-8').replace('\\', '/')
            if logical.lower() != LOGICAL:
                return super().imported(engine, address, size, user)
            mode = self.cstring(args[1])
            caller = self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base
            if caller != 0x147935d or mode not in [b'rb', b'rb+', b'wb', b'wb+']:
                raise ValueError('Unowned original configuration fopen caller/mode')
            if len(state['handles']) >= 8:
                raise ValueError('Original configuration overlay handle quota exceeded')
            if mode not in [b'wb', b'wb+'] and state['content'] is None:
                if Path(state['physicalSource']).exists():
                    raise ValueError('Original missing configuration source unexpectedly appeared')
                if self.file_errno is None:
                    self.file_errno = self.allocate(4)
                self.put(self.file_errno, 'I', 2)  # Rechecked original ENOENT.
                result = 0
            else:
                if mode in [b'wb', b'wb+']:
                    state['content'] = bytearray()
                result = self.allocate(0x20)
                state['handles'][result] = {'position': 0, 'eof': False, 'write': mode != b'rb', 'read': mode != b'wb'}
            record = {'name': name, 'logicalPath': logical, 'mode': mode.decode(),
                      'callerRva': caller, 'handle': result, 'darwinErrno': 2 if not result else None}
        elif name in ['_fread', '_fwrite', '_fseek', '_fseeko', '_ftell', '_ftello',
                      '_fclose', '_fflush', '_ferror', '_feof']:
            handle = args[3] if name in ['_fread', '_fwrite'] else args[0]
            if handle not in state['handles']:
                return super().imported(engine, address, size, user)
            stream = state['handles'][handle]
            record = {'name': name, 'handle': handle, 'positionBefore': stream['position']}
            data = state['content']
            if name in ['_fread', '_fwrite']:
                amount = args[1]*args[2]
                if amount > MAXIMUM or state['transferredBytes']+amount > 16*MAXIMUM:
                    raise ValueError('Original configuration stdio transfer quota exceeded')
                state['transferredBytes'] += amount
                at = stream['position']
                if name == '_fread':
                    if not stream['read']:
                        raise ValueError('Original configuration attempted reading a write-only stream')
                    output = bytes(data[at:at+amount])
                    if output and not self.writable_file_memory(args[0], len(output)):
                        raise ValueError('Original configuration read escaped writable native memory')
                    if output:
                        engine.mem_write(args[0], output)
                    stream['position'] += len(output)
                    stream['eof'] = len(output) < amount
                    result = len(output)//args[1] if args[1] else 0
                    record['bytes'] = len(output)
                else:
                    if not stream['write'] or at+amount > MAXIMUM or amount and not self.library_pointer(args[0], amount):
                        raise ValueError('Original configuration write escaped owned source/storage bounds')
                    output = bytes(engine.mem_read(args[0], amount)) if amount else b''
                    if amount:
                        if at+amount > len(data):
                            data.extend(bytes(at+amount-len(data)))
                        data[at:at+amount] = output
                    stream['position'] += amount
                    result = args[2] if args[1] else 0
                    record['bytes'] = amount
            elif name in ['_fseek', '_fseeko']:
                displacement = args[1] if args[1] < 1 << 63 else args[1]-(1 << 64)
                if args[2] not in [0, 1, 2]:
                    raise ValueError('Original configuration seek origin is unsupported')
                target = [0, stream['position'], len(data)][args[2]]+displacement
                if not 0 <= target <= MAXIMUM:
                    raise ValueError('Original configuration seek exceeds bounded file storage')
                stream['position'], stream['eof'], result = target, False, 0
            elif name in ['_ftell', '_ftello']:
                result = stream['position']
            elif name == '_fclose':
                del state['handles'][handle]
                result = 0
            elif name == '_feof':
                result = int(stream['eof'])
            else:
                result = 0  # Owned unbuffered stream flush/error query.
            record.update(result=result, positionAfter=stream['position'])
        else:
            return super().imported(engine, address, size, user)
        if len(state['calls']) >= 65536:
            raise ValueError('Original configuration stdio call quota exceeded')
        state['calls'].append(record)
        engine.reg_write(r.UC_X86_REG_RAX, result)
        self.ret()
