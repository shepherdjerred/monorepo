"""Original CameraConfig constructor defaults and exact CLASSIC field loading.

No camera motion, projection, clock, viewport or readiness is supplied here.
Authored fields pass through the original typed reader without normalization.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from hashlib import sha256
from character_asset_native import NativeCharacterAssets
from vfx_asset_native import REGISTRY
from vfx_spawn_native import sha
from unicorn import x86_const as r


def file_sha(file):
    result = sha256()
    with Path(file).open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            result.update(chunk)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'client', 'input', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Fresh original camera constructor output required')
    request_bytes = args.input.read_bytes()
    request = json.loads(request_bytes)
    if (request['schema'] != 1 or request['kind'] != 'original-classic-camera-field-input' or
            request['build'] != '16.21.829.8620' or request['protocol'] != '20e09df23c66b85e' or
            request['objectPath'] != 'Globals/CameraConfig_CLASSIC' or
            request['object']['pathHash'] != '28f338a2' or request['object']['classHash'] != 'dff5a8f8' or
            request['scope']['missingPropertiesSynthesized'] is not False):
        raise ValueError('Exact original CLASSIC camera fields required')
    inputs = {str(args.input.resolve()): sha(request_bytes)}
    for file, digest in request['inputs'].items():
        if file_sha(file) != digest:
            raise ValueError('Original camera archive input changed: ' + file)
        inputs[file] = digest
    paths = {Path(__file__), *[Path(inspect.getfile(base)) for base in NativeCharacterAssets.__mro__
                              if base is not object]}
    for file in paths | {args.package/'profile.json', args.package/'image.bin', args.client}:
        inputs[str(file.resolve())] = file_sha(file)
    for url, digest in request['sourceBefore'].items():
        from urllib.parse import urlparse, unquote
        name = unquote(urlparse(url).path)
        if len(name) >= 3 and name[0] == '/' and name[2] == ':':
            name = name[1:]
        if file_sha(name) != digest:
            raise ValueError('Original camera acquisition producer changed: ' + name)
        inputs[str(Path(name).resolve())] = digest
    raw = Path(request['source']['file']).read_bytes()
    if (len(raw) != request['source']['bytes'] or sha(raw) != request['source']['sha256'] or
            sha(raw) != '7aea41e5f9a1ad4684711e410c37d126edbbc70cf9209bdde2a87e2f36a744aa'):
        raise ValueError('Exact original globals BIN required')
    inputs[str(Path(request['source']['file']).resolve())] = sha(raw)
    serialized = []
    for span in request['fields']:
        data = raw[span['offset']:span['offset']+span['bytes']]
        if (len(data) != span['bytes'] or sha(data) != span['sha256'] or
                data[:4].hex() != bytes.fromhex(span['fieldHash'])[::-1].hex()):
            raise ValueError('Original camera serialized field changed')
        serialized.append(data)
    if len(serialized) != 5:
        raise ValueError('All five actual CLASSIC camera fields required')
    n = NativeCharacterAssets(args.package, args.client)
    n.initialize_character_types()
    # Original caller order: the embedded CameraTrapezoid descriptor must be
    # registered before CameraConfig. A typed reader consuming every byte alone
    # does not prove that an unregistered embedded descriptor populated fields.
    for start, end in [(0x22488a, 0x224896), (0x2248b0, 0x2248bc)]:
        n.call(start, {}, end)
    count, array = n.u32(n.base+REGISTRY+8), n.q(n.base+REGISTRY)
    if not 821 <= count <= 4096:
        raise ValueError('Original bounded camera reflection registry required')
    previous = dict(n.types)
    n.types = {n.u32(n.q(array+index*8)+8): n.q(array+index*8) for index in range(count)}
    if len(n.types) != count or any(n.types.get(key) != value for key, value in previous.items()):
        raise ValueError('Camera registration changed existing type identities')
    n.type_catalog = n.catalog()
    descriptor = n.type_catalog['dff5a8f8']
    defaults = n.observe_actor_fields(0xdff5a8f8, [])
    repeated = n.observe_actor_fields(0xdff5a8f8, [])
    if defaults['objectHex'] != repeated['objectHex']:
        raise ValueError('Original camera constructor defaults differ between owned objects')
    if descriptor['size'] != 160 or descriptor['constructRva'] != 0x221d10:
        raise ValueError('Exact original CameraConfig constructor/layout required')
    padding_controls = []
    for poison in [0xa5, 0x5a]:
        allocation = n.allocate(192)
        n.u.mem_write(allocation, bytes([poison])*192)
        obj = allocation+16
        n.call(descriptor['constructRva'], {r.UC_X86_REG_RDI: obj})
        value = bytes(n.u.mem_read(obj, 160))
        if (bytes(n.u.mem_read(allocation, 16)) != bytes([poison])*16 or
                bytes(n.u.mem_read(obj+160, 16)) != bytes([poison])*16 or
                value[:157].hex() != defaults['objectHex'][:157*2] or
                value[157:] != bytes([poison])*3):
            raise ValueError('Original constructor initialized extent/padding/neighbor control differs')
        padding_controls.append({'poison': poison, 'initializedPrefixMatchesDefaults': True,
                                 'trailingPaddingHex': value[157:].hex(), 'neighborsUnchanged': True})
    loaded = n.observe_actor_fields(0xdff5a8f8, serialized)
    if any(row['originalSkippedFields'] or row['pendingReferences']
           for row in [defaults, repeated, loaded]):
        raise ValueError('Original camera fields skipped or left unresolved references')
    checked = []

    def verify_fields(class_hash, fields, address, trail):
        native = n.type_catalog[class_hash]
        properties = {row['hash']: row for row in native['properties']}
        for identity, field in fields.items():
            prop = properties[int(identity, 16)]
            destination = address + prop['offset']
            if field['type'] == 'F32':
                if prop['type'] != 10 or bytes(n.u.mem_read(destination, 4)) != struct.pack('<f', field['value']):
                    raise ValueError('Original authored camera float did not load: ' + '/'.join(trail+[identity]))
                checked.append({'path': trail+[identity], 'address': destination,
                                'rawHex': bytes(n.u.mem_read(destination, 4)).hex()})
            elif field['type'] == 'Embedded':
                child = n.type_catalog[field['classHash']]
                if prop['type'] != 131 or prop['referencedTypeRva'] != child['rva']:
                    raise ValueError('Original embedded camera descriptor differs')
                verify_fields(field['classHash'], field['fields'], destination, trail+[identity])
            else:
                raise ValueError('Unobserved authored camera field type')

    verify_fields('dff5a8f8', request['object']['fields'], loaded['object'], [])
    if len(checked) != 14:
        raise ValueError('All fourteen actual camera scalar leaves must match raw bytes')
    for file, digest in inputs.items():
        if file_sha(file) != digest:
            raise ValueError('Original camera source/input changed: ' + file)
    result = {'schema': 1, 'kind': 'original-classic-camera-constructor-field-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'inputSha256': sha(request_bytes),
              'descriptor': descriptor, 'embeddedDescriptor': n.type_catalog['47fc4706'],
              'defaults': defaults, 'loaded': loaded, 'authoredScalarChecks': checked,
              'constructorInitializedBytes': 157, 'trailingPaddingOffsets': [157, 158, 159],
              'constructorPaddingControls': padding_controls,
              'constructorSource': {'rva': 0x221d10, 'bytes': 0x73,
                                    'sha256': sha(n.image[0x221d10:0x221d83])},
              'repeatedConstructorByteIdentical': True, 'inputs': inputs,
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalConstructorExecuted': True, 'allAuthoredFieldsConsumed': True,
                        'omittedDefaultsFromOriginalConstructor': True,
                        'cameraMotionExecuted': False, 'projectionExecuted': False,
                        'browserCameraAdmitted': False, 'nativeSpectatorAdmitted': False}}
    args.output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'objectBytes': loaded['size'],
                      'fields': loaded['fields'], 'properties': len(descriptor['properties'])}))


if __name__ == '__main__':
    main()
