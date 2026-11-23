"""Read original recorded Map11 mode/constants for a guarded cold-unit control.

Only the actual constants link is fixed. Every remaining source mode reference
stays unresolved and is protected during consumers; no full mode readiness is
inferred from the narrow original constant-index/publication prefix.
"""
import json
from contextlib import contextmanager
from pathlib import Path
import unicorn
from vfx_spawn_native import sha


def install_recorded_mode_constants(fixture, input_path):
    n = fixture.native
    if n.q(n.base+0x2561d18):
        raise ValueError('Original recorded mode/constants provider must be cold')
    encoded = fixture.raw(Path(input_path))
    request = json.loads(encoded)
    tools = Path(__file__).resolve().parent
    if (request['kind'] != 'original-recorded-map11-mode-constant-input' or request['build'] != n.profile['clientVersion'] or
            request['protocol'] != n.profile['protocolDigest'] or request['startup']['configuredMapId'] != 11 or
            request['sources']['preparerSha256'] != sha((tools/'prepare-recorded-mode-constant-input.mjs').read_bytes()) or
            request['sources']['readerSha256'] != sha((tools/'exact-map-bin.mjs').read_bytes())):
        raise ValueError('Exact recorded mode/constants source projection required')
    for file, digest in request['inputs'].items():
        if sha(fixture.raw(Path(file))) != digest:
            raise ValueError('Recorded mode input changed: '+file)
    raw = fixture.raw(Path(request['source']['file']))
    if len(raw) != request['source']['bytes'] or sha(raw) != request['source']['sha256']:
        raise ValueError('Original Map11 mode BIN bytes differ')
    if 0x89ce9636 not in n.types or 0x0c07acc5 not in n.types:
        raise ValueError('Original recorded mode/constants metadata classes are unregistered')
    layout = n.catalog()['89ce9636']
    links = [row for row in layout['properties'] if row['offset'] == 0x178]
    if len(links) != 1 or links[0]['hash'] != 0x34c9a66e:
        raise ValueError('Original native constants field identity/offset differs')
    rows = {}
    for name in ['mode', 'constants']:
        row = request[name]
        fields = []
        for field in row['fields']:
            start, size = field['offset'], field['bytes']
            if not 0 <= start <= len(raw)-size or not 5 <= size <= 1024*1024:
                raise ValueError('Original mode/constants field escaped its exact source')
            part = raw[start:start+size]
            if sha(part) != field['sha256']:
                raise ValueError('Original mode/constants field digest differs')
            fields.append(part)
        rows[name] = {'identity': row['identity'], 'loaded': n.read_typed_fields(row['typeHash'], fields)}
    mode, constants = rows['mode']['loaded'], rows['constants']
    if mode['typeHash'] != 0x89ce9636 or constants['loaded']['typeHash'] != 0x0c07acc5:
        raise ValueError('Original mode/constants native class identities differ')
    installed = n.build_constant_index(mode, constants, request['startup']['modeHash'])
    unresolved = [link for link in mode['pendingReferences'] if link['destination'] != mode['object']+0x178]
    return {'inputSha256': sha(encoded), 'recordedStartup': request['startup'], 'modeIdentity': rows['mode']['identity'],
            'constantsIdentity': constants['identity'], 'modeRead': mode, 'constantsRead': constants['loaded'],
            'nativeIndex': installed, 'unresolvedModeReferences': unresolved,
            'nativeConstantsField': links[0],
            'scope': {'originalRecordedModeConstantsLinked': True, 'otherModeReferencesAdmitted': False,
                      'fullModePostloadExecuted': False, 'liveWorldBindingsAdmitted': False}}


@contextmanager
def reject_unresolved_mode_reads(n, selection):
    spans = [(row['destination'], row['destination']+8) for row in selection['unresolvedModeReferences']]
    raw_read, raw_write = n.u.mem_read, n.u.mem_write
    def reject(address, size):
        if any(size and address < end and address+size > start for start, end in spans):
            raise ValueError('Cold consumer read an unresolved original mode reference')
    def host_read(address, size):
        reject(address, size)
        return raw_read(address, size)
    def guest_read(engine, access, address, size, value, user):
        reject(address, size)
    hook = None
    n.u.mem_read = host_read
    try:
        if spans:
            hook = n.u.hook_add(unicorn.UC_HOOK_MEM_READ, guest_read,
                                begin=min(start for start, _ in spans)-31,
                                end=max(end for _, end in spans))
        yield
    finally:
        n.u.mem_read, n.u.mem_write = raw_read, raw_write
        if hook is not None:
            n.u.hook_del(hook)
