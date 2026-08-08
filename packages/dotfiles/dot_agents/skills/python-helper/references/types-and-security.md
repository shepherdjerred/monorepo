# Python types and security

Read this when designing typed boundaries, introspecting annotations, processing t-strings, invoking subprocesses, handling archives or pickle, or generating secrets.

## Deferred annotations

Python 3.14 uses deferred annotation evaluation. This is not the same model as `from __future__ import annotations` stringization. `annotationlib` exposes value, forward-reference, and string formats.

Annotation introspection can execute arbitrary code. Do not evaluate annotations from untrusted modules as harmless metadata.

## T-strings

Template strings return a `Template`, not a safe output string. A processor must deliberately handle interpolation values, conversions, and format specifications. T-strings are not automatically HTML-escaped or SQL-parameterized.

## Runtime models

Pydantic `Field` metadata on a plain class does not validate anything. Use `BaseModel`, Pydantic dataclass integration, or `TypeAdapter`.

Prefer precise structures:

- `TypedDict` for statically typed mapping shapes without runtime validation,
- dataclasses for in-process value objects,
- Pydantic or explicit parsers for external values,
- `Mapping[K, V]` when mutation is not required.

## File and path handling

Use explicit text encoding on Python 3.14. Python 3.15 plans UTF-8 by default, but prerelease plans are not a reason to omit encoding today.

Python 3.14 adds `pathlib.Path.copy`, `copy_into`, `move`, and `move_into`. Metadata preservation is an explicit copying choice.

## Subprocesses

Argument sequences avoid shell parsing:

```python
import subprocess

subprocess.run(["git", "status", "--short"], check=True)
```

With `shell=True`, the application owns correct escaping. Do not pass untrusted input through a shell.

## Serialization and archives

Unpickling untrusted data can execute arbitrary code. Use a data-only format plus validation.

Python 3.14 makes tarfile's `data` extraction filter the default. That reduces path and device-file risk but does not make an arbitrary archive trusted; inspect type, path, size, and resource limits.

## Secrets

Use the `secrets` module for tokens and password-reset material. `random` is for simulation and non-security randomness.

## Caching and slots

An unbounded `functools.cache` can retain every distinct key. Use it only with a bounded key space or choose a bounded LRU policy.

`__slots__` can reduce per-instance memory and restrict attributes, but speed and layout benefits are workload-dependent. Measure before adopting it as an optimization.

## Primary documentation

- [annotationlib](https://docs.python.org/3/library/annotationlib.html)
- [string.templatelib](https://docs.python.org/3/library/string.templatelib.html)
- [typing](https://docs.python.org/3/library/typing.html)
- [pathlib](https://docs.python.org/3/library/pathlib.html)
- [subprocess security](https://docs.python.org/3/library/subprocess.html)
- [secrets](https://docs.python.org/3/library/secrets.html)
- [pickle](https://docs.python.org/3/library/pickle.html)
- [tarfile](https://docs.python.org/3/library/tarfile.html)
