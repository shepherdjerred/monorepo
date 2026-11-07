"""Read-only physical CFG/INI requests before the client's original WAD fallback.

Only declared presentation path families resolve against an explicitly supplied
working directory. Missing physical files return real, rechecked ENOENT; neither
archive lookup nor a game callback is replaced.
"""
import hashlib
from pathlib import Path, PurePosixPath
from unicorn import x86_const as r


class NativeClientLooseFiles:
    def __init__(self, *args, **kwargs):
        self.client_loose_root = None
        self.client_loose_files = {}
        self.client_loose_file_calls = []
        super().__init__(*args, **kwargs)
        if self.source.imports.get(0x1fee86a) != '_fopen' or self.file_errors[2] != 'No such file or directory':
            raise ValueError('Original Darwin read-only fopen/ENOENT contract differs')

    def configure_client_loose_files(self, root):
        root = Path(root).resolve(strict=True)
        if self.client_loose_root is not None or not root.is_dir():
            raise ValueError('One explicit physical client working directory required')
        self.client_loose_root = root
        return {'workingDirectory': str(root), 'readOnly': True, 'hostWritesAllowed': False,
                'pathFamilies': ['DATA/CFG/*.cfg', 'DATA/CFG/*.ini', 'DATA/Particles/*.ini', 'ASSETS/Maps/*.ini']}

    def validate_client_loose_files(self):
        for observed in self.client_loose_files.values():
            physical = Path(observed['physicalPath'])
            present = physical.is_file()
            if physical.exists() != present or present != observed['present'] or present and (
                    physical.stat().st_size != observed['bytes'] or
                    hashlib.sha256(physical.read_bytes()).hexdigest() != observed['sha256']):
                raise ValueError('Physical client presentation file changed: ' + str(physical))
        return list(self.client_loose_files.values())

    def imported(self, engine, address, size, user):
        if address - self.base != 0x1fee86a:
            return super().imported(engine, address, size, user)
        raw_path = self.cstring(engine.reg_read(r.UC_X86_REG_RDI)).decode('utf-8')
        logical = raw_path.replace('\\', '/')
        path, lowered = PurePosixPath(logical), logical.lower()
        admitted = ((lowered.startswith('data/cfg/') and path.suffix.lower() in ['.cfg', '.ini']) or
                    (lowered.startswith('data/particles/') or lowered.startswith('assets/maps/')) and path.suffix.lower() == '.ini')
        if not admitted:
            return super().imported(engine, address, size, user)
        if self.client_loose_root is None or path.is_absolute() or any(part in ['..', '.'] for part in path.parts):
            raise ValueError('Declared bounded client presentation file path required')
        if self.cstring(engine.reg_read(r.UC_X86_REG_RSI)) != b'rb':
            raise ValueError('Physical client presentation files permit binary reads only')
        physical = (self.client_loose_root / Path(*path.parts)).resolve()
        if not physical.is_relative_to(self.client_loose_root):
            raise ValueError('Physical client presentation file escaped its working directory')
        present = physical.is_file()
        if physical.exists() != present:
            raise ValueError('Physical client presentation request is not a regular file')
        if present and physical.stat().st_size > 0x100000:
            raise ValueError('Physical client presentation file exceeds its explicit byte bound')
        data = physical.read_bytes() if present else None
        observed = {'logicalPath': logical, 'physicalPath': str(physical), 'present': present,
                    'bytes': len(data) if present else None,
                    'sha256': hashlib.sha256(data).hexdigest() if present else None}
        key = lowered
        prior = self.client_loose_files.get(key)
        if prior is not None and (Path(prior['physicalPath']) != physical or
                any(prior[field] != observed[field] for field in ['present', 'bytes', 'sha256'])):
            raise ValueError('Repeated physical client file lookup changed')
        if prior is None:
            self.client_loose_files[key] = observed
        self.client_loose_file_calls.append({**observed, 'darwinErrno': None if present else 2,
                                            'hostWriteExecuted': False})
        if present:
            self.allow_file(physical)
            engine.reg_write(r.UC_X86_REG_RDI, self.allocate_text(str(physical).replace('\\', '/')))
            return super().imported(engine, address, size, user)
        if self.file_errno is None:
            self.file_errno = self.allocate(4)
        self.put(self.file_errno, 'I', 2)
        engine.reg_write(r.UC_X86_REG_RAX, 0)
        self.ret()
