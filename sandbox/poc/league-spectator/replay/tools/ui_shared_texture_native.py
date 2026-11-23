"""Read/register the authored UI_PRIMARY_TEXTURE row through original code."""
import json
from pathlib import Path

from unicorn import x86_const as r
from ui_shared_constants_native import sha


def initialize_original_ui_primary_texture(n, backend, raw_file, typed_file):
    raw, typed_raw = Path(raw_file).read_bytes(), Path(typed_file).read_bytes()
    typed = json.loads(typed_raw)
    expected = "b8b9ced72938a29f86468931a8c147c74515d74b8cc067cf902cbc0bd018a402"
    if sha(raw) != expected or typed["sourceSha256"] != expected:
        raise ValueError("Exact archived Shared texture declaration required")
    matches = []

    def visit(value):
        if isinstance(value, dict):
            if value.get("fields", {}).get("8d39bde6", {}).get("value") == "UI_PRIMARY_TEXTURE":
                matches.append(value)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(typed)
    if len(matches) != 1 or matches[0]["classHash"] != "3745189b":
        raise ValueError("Unique original UI texture definition required")
    fields = []
    for span in matches[0]["fieldSpans"]:
        begin, size = span["offset"], span["bytes"]
        data = raw[begin:begin + size]
        if begin < 0 or size < 5 or len(data) != size or int.from_bytes(data[:4], "little") != int(span["fieldHash"], 16):
            raise ValueError("Original UI texture field escaped source bounds")
        fields.append(data)
    read = n.observe_actor_fields(0x3745189B, fields)
    if read["originalSkippedFields"] or read["pendingReferences"]:
        raise ValueError("Original UI texture retains skipped fields or unresolved references")
    table, methods = n.q(backend), {}
    for offset, expected_method in [(0x278, 0x1914DC0), (0x280, 0x19142D0),
                                    (0x2C8, 0x1914440), (0x2E8, 0x1928490)]:
        method = n.q(n.base + 0x2408570 + offset)
        if method != n.base + expected_method:
            raise ValueError("Original UI texture virtual identity differs")
        n.put(table + offset, "Q", method)
        methods[offset] = expected_method
    cache = n.q(n.base + 0x247DA80)
    if not cache:
        n.call(0x19125AA, {}, end=0x19125D8)
        cache = n.q(n.base + 0x247DA80)
    if n.allocations.get(cache) != 0x30:
        raise ValueError("Original Shared default texture cache is unowned")
    name = n.q(read["object"])
    if n.cstring(name).decode("ascii") != "UI_PRIMARY_TEXTURE":
        raise ValueError("Original typed texture name differs")
    n.call(methods[0x278], {r.UC_X86_REG_RDI: backend, r.UC_X86_REG_RSI: name})
    if n.u.reg_read(r.UC_X86_REG_RAX):
        raise ValueError("Original UI texture registration requires its cold name")
    n.call(methods[0x2C8], {r.UC_X86_REG_RDI: backend, r.UC_X86_REG_RSI: read["object"]})
    n.call(methods[0x278], {r.UC_X86_REG_RDI: backend, r.UC_X86_REG_RSI: name})
    view = n.u.reg_read(r.UC_X86_REG_RAX)
    if n.allocations.get(view) != 0x48:
        raise ValueError("Original UI texture registration did not publish its own view")
    header = n.q(view + 8)
    resources = [row for row in n.gpu_records if row["pointer"] == header]
    if len(resources) != 1 or not resources[0]["gpuBytesVerified"]:
        raise ValueError("Original UI texture lacks an exact GPU-verified resource")
    missing = n.allocate_text("SCOUT_UNREGISTERED_UI_TEXTURE_CONTROL")
    n.call(methods[0x278], {r.UC_X86_REG_RDI: backend, r.UC_X86_REG_RSI: missing})
    if n.u.reg_read(r.UC_X86_REG_RAX):
        raise ValueError("Unknown original UI texture name unexpectedly resolved")
    inputs = {str(Path(raw_file).resolve()): sha(raw), str(Path(typed_file).resolve()): sha(typed_raw)}
    if any(sha(Path(path).read_bytes()) != digest for path, digest in inputs.items()):
        raise ValueError("Original Shared texture input changed")
    return {"inputs": inputs, "originalRead": read, "defaultCache": cache,
            "originalMethods": {hex(key): value for key, value in methods.items()},
            "view": view, "viewHex": bytes(n.u.mem_read(view, 0x48)).hex(),
            "gpuResource": resources[0], "unregisteredNameResult": 0,
            "scope": {"originalNamedTextureViewPublished": True, "exactGpuResourceReadback": True,
                      "uiDrawVerified": False, "nativeUiSceneAdmitted": False}}
