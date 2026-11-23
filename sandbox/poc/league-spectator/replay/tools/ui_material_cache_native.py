"""Construct the original material-cache prerequisite for UI scene ownership."""
from shared_graphics_registries_native import REGISTRIES


def initialize_original_ui_material_cache(n):
    entries = [row for row in REGISTRIES if row[2] == 0x247C9C0]
    if entries != [(0x180D41B, 0x180D437, 0x247C9C0, 0x90)]:
        raise ValueError("Original material-cache startup source identity differs")
    start, end, global_, size = entries[0]
    if n.image[start:end] != n.source.image[start:end]:
        raise ValueError("Original material-cache construction block changed")
    before = {key: n.q(n.base + key) for key in [0x246FDF0, 0x24712C8]}
    previous = n.q(n.base + global_)
    if previous:
        raise ValueError("Original UI material-cache control requires its cold owner")
    n.call(start, {}, end)
    owner = n.q(n.base + global_)
    if n.allocations.get(owner) != size or any(n.q(n.base + key) != value for key, value in before.items()):
        raise ValueError("Original material-cache owner or retained service identity differs")
    return {"startupBlock": [start, end], "originalConstructorRva": 0x17C3FD0,
            "globalRva": global_, "object": owner, "bytes": size,
            "originalHex": bytes(n.u.mem_read(owner, size)).hex(),
            "originalConstructionReturned": True, "retainedServices": {hex(key): value for key, value in before.items()},
            "shaderMaterialsAcquired": False, "gpuDrawVerified": False}
