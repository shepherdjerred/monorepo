"""Execute the original graphics-registry dependency group.

Some constructors acquire default materials and require a real shader catalog.
Only a completed call proves the group returned. Constructed registry objects
do not establish complete asset acquisition, pipeline or draw readiness.
"""
from shared_graphics_registries_native import REGISTRIES


def initialize_original_ui_graphics_registries(n):
    if n.device is None:
        raise ValueError("Original UI graphics registries require an owned graphics device")
    retained = {key: n.q(n.base + key) for key in [0x246FDF0, 0x24712C8]}
    if n.allocations.get(retained[0x246FDF0]) != 0x108 or not retained[0x24712C8]:
        raise ValueError("Original texture/resource-group prerequisites required")
    records = []
    for start, end, global_, size in REGISTRIES:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError("Original graphics-registry construction source changed")
        existing = n.q(n.base + global_)
        if not existing:
            n.call(start, {}, end)
        owner = n.q(n.base + global_)
        if n.allocations.get(owner) != size or existing and owner != existing:
            raise ValueError("Original graphics-registry owner/allocation differs")
        if any(n.q(n.base + key) != value for key, value in retained.items()):
            raise ValueError("Original graphics-registry startup replaced retained service ownership")
        records.append({"startupBlock": [start, end], "globalRva": global_, "object": owner,
                        "bytes": size, "existingOriginalOwnerRetained": bool(existing),
                        "originalHex": bytes(n.u.mem_read(owner, size)).hex(), "completed": True})
    return {"registries": records, "retainedServices": {hex(key): value for key, value in retained.items()},
            "sourceDependencyGroupConstructed": True, "shaderCatalogAttached": n.shader_catalog is not None,
            "fullGraphicsStartupExecuted": False, "shaderAssetsReady": False, "gpuDrawVerified": False}
