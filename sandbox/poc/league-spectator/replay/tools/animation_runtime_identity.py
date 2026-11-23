"""Content identity of the interpreter and native libraries evaluating frames."""
import hashlib
import ctypes
import json
from pathlib import Path
import sys
import capstone
import unicorn


def animation_runtime_identity():
    files = {Path(sys.executable).resolve(), Path(sys._base_executable).resolve()}
    # NativeSpawn services imported float mathematics through this exact loaded
    # host CRT. Resolve its actual module, rather than assuming a System32 path.
    crt = ctypes.CDLL('ucrtbase.dll')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    module_path = kernel.GetModuleFileNameW
    module_path.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint32]
    module_path.restype = ctypes.c_uint32
    buffer = ctypes.create_unicode_buffer(32768)
    size = module_path(crt._handle, buffer, len(buffer))
    if not 0 < size < len(buffer):
        raise OSError(ctypes.get_last_error(), 'Cannot identify the loaded native animation math CRT')
    math_library = Path(buffer.value).resolve()
    files.add(math_library)
    for module in [unicorn, capstone]:
        root = Path(module.__file__).resolve().parent
        files.update(file for file in root.rglob('*')
                     if file.is_file() and file.suffix.lower() in ['.py', '.dll', '.pyd', '.so', '.dylib'])
    base = Path(sys.base_prefix)
    files.update(base.glob('*.dll'))
    if (base/'DLLs').is_dir():
        files.update(file for file in (base/'DLLs').iterdir()
                     if file.is_file() and file.suffix.lower() in ['.pyd', '.dll'])
    result = {'schema': 1, 'python': sys.version, 'unicorn': unicorn.__version__,
              'hostMathLibrary': str(math_library),
              'capstone': capstone.__version__, 'files': {
                  str(file): hashlib.sha256(file.read_bytes()).hexdigest()
                  for file in sorted(files)}}
    result['fingerprint'] = hashlib.sha256(json.dumps(result, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return result


if __name__ == '__main__':
    print(json.dumps(animation_runtime_identity(), separators=(',', ':')))
