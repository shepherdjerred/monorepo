"""Install the original selected mode prefix after its full reference fixup."""
from unicorn import x86_const as r


def initialize_linked_mode_provider(n, graph, mode_evidence):
    selected = mode_evidence['selectedIdentity']
    mode_hash = mode_evidence['selectedMode']['modeHash']
    if (graph['build'] != n.profile['clientVersion'] or graph['protocol'] != n.profile['protocolDigest'] or
            not graph['scope']['referenceLinksFixed'] or graph['boundaries'] or
            not graph['fixups'] or graph['fixups']['pendingAfter'] or
            graph['fixups']['rejectedNonNullReferences']):
        raise ValueError('Original mode provider requires a fully fixed matching asset graph')
    roots = [case for case in graph['cases'] if case['identity'] == selected]
    if len(roots) != 1 or roots[0]['typeHash'] != 0x89ce9636:
        raise ValueError('The linked graph must include the selected recorded GameModeMapData')
    loaded = roots[0]['loaded']
    provider = loaded['object']
    links = [link for link in graph['fixups']['links'] if link['ownerIdentity'] == selected]
    if (len(links) != len(loaded['pendingReferences']) or
            any(n.q(link['destination']) != link['fixedPointer'] for link in links) or
            n.u32(provider + 8) != mode_hash):
        raise ValueError('Selected mode hash or fixed reference storage differs')
    constants = [link for link in links if link['destination'] == provider + 0x178]
    if len(constants) != 1 or not constants[0]['fixedPointer']:
        raise ValueError('Selected mode requires its original fixed constant definition')
    before = n.q(n.base + 0x2561d18)
    n.call(0x409d00, {r.UC_X86_REG_RDI: provider})
    n.call(0x60b9ee, {r.UC_X86_REG_RSI: mode_hash}, 0x60b9f4)
    n.call(0x409890, {r.UC_X86_REG_RDI: provider}, 0x4098d0)
    if n.q(n.base + 0x2561d18) != provider:
        raise ValueError('Original linked mode-provider publication differs')
    return {'provider': provider, 'previousPrefixProvider': before, 'identity': selected,
            'modeHash': mode_hash, 'fixedReferences': len(links), 'constants': constants[0]['fixedPointer'],
            'originalConstantIndexRva': 0x409d00, 'originalPublicationPrefix': [0x409890, 0x4098d0],
            'indexBuckets': n.q(provider + 0x190), 'indexEntries': n.q(provider + 0x1a0),
            'allSelectedModeReferencesFixed': True, 'fullGlobalPostloadExecuted': False,
            'readyGlobalProviderEstablished': False, 'acceptedReplayEntities': False}
