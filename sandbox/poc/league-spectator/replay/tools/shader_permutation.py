"""Exact DX11 TOC selection, independently comparable to hexshade::bundle.

This is the translated-graphics adapter's selector. It does not establish that
the macOS client's Metal backend uses the same TOCs, nor compile a shader.
"""
from xxhash import xxh64_intdigest


def macro_text(name, value):
    if not isinstance(name, str) or not name or not isinstance(value, str):
        raise ValueError('Invalid shader macro name/value')
    return name if not value else name + '=' + value


def macro_hash(name, value):
    result = 0x811c9dc5
    # Match Rust's char-by-char lowercase expansion (not contextual whole-string
    # lowercasing). Native requests are ASCII; this also keeps the helper's
    # accepted UTF-8 string contract consistent with the pinned hash library.
    lowered = ''.join(character.lower() for character in macro_text(name, value))
    for byte in lowered.encode('utf-8'):
        result = ((result ^ byte) * 0x01000193) & 0xffffffff
    return f'{result:08x}'


def select_permutation(source, defines):
    if len(defines) > 32:
        raise ValueError('Unadmitted shader define count')
    requested = {}
    for definition in defines:
        name, value = definition['name'], definition['value']
        macro_text(name, value)
        if name in requested:
            raise ValueError('Duplicate native shader define')
        requested[name] = value
    declared = set()
    for definition in source['baseDefines']:
        identity = macro_hash(definition['name'], definition['value'])
        if identity != definition['hash']:
            raise ValueError('Prepared shader macro hash differs from its name/value')
        declared.add(identity)
    # The declaration is the full macro hash, including its value. An unknown
    # value is filtered just like an unknown name; it is not coerced to a known
    # value. Only an exact remaining permutation may be selected below.
    kept = sorted((name, value) for name, value in requested.items()
                  if macro_hash(name, value) in declared)
    key = f'{xxh64_intdigest("".join(macro_text(name, value) for name, value in kept)):016x}'
    matches = [row for row in source['permutations'] if row['hash'] == key]
    if len(matches) > 1:
        raise ValueError('Ambiguous native shader permutation')
    return {'hash': key, 'id': matches[0]['id'] if matches else None,
            'defines': [{'name': name, 'value': value} for name, value in kept]}
