"""Original client configuration with an explicitly supplied ROFL launch input.

Only launch-kind selection runs after construction. Other command-line settings
and the recorded client's preferences remain unknown.
"""
from unicorn import x86_const as r


def initialize_replay_client_configuration(n, launch_path):
    if (not isinstance(launch_path, str) or not launch_path or '\0' in launch_path or
            not launch_path.isascii() or len(launch_path.encode('ascii')) > 1023 or
            not launch_path.endswith('.rofl')):
        raise ValueError('Explicit bounded ASCII .rofl launch path required')
    if n.q(n.base + 0x24705d0):
        raise ValueError('Original client configuration must be cold')
    configuration = n.allocate(0x1c0)
    n.call(0x624060, {r.UC_X86_REG_RDI: configuration})
    if n.q(n.base + 0x24705d0) != configuration or n.u32(configuration + 8) != 0:
        raise ValueError('Original client configuration constructor differs')
    launch, reference = n.allocate(24), n.allocate(8)
    data = launch_path.encode('ascii')
    text = n.allocate(len(data) + 1)
    n.u.mem_write(text, data + b'\0')
    n.call(0x11fe0, {r.UC_X86_REG_RDI: launch, r.UC_X86_REG_RSI: text,
                     r.UC_X86_REG_RDX: len(data)})
    n.put(reference, 'Q', launch)
    n.call(0x624540, {r.UC_X86_REG_RDI: configuration,
                     r.UC_X86_REG_RDX: reference}, 0x6248c6)
    if n.q(n.base + 0x24705d0) != configuration or n.u32(configuration + 8) != 3:
        raise ValueError('Original supplied ROFL launch selection differs')
    return {'object': configuration, 'globalRva': 0x24705d0,
            'constructorRva': 0x624060, 'constructorMode': 0,
            'suppliedLaunchAscii': launch_path, 'launchKindPrefix': [0x624540, 0x6248c6],
            'modeValue': 3, 'remainingCommandLinePassExecuted': False,
            'actualSpectatorConfigurationRecovered': False}
