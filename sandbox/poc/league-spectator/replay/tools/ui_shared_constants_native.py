"""Register exact authored UI constant rows through original CPU consumers.

This proves original named parameter objects, not constant-buffer publication,
uniform uploads, a populated scene or GPU rendering.
"""
import hashlib
import json
import struct
from pathlib import Path

from unicorn import x86_const as r
from vfx_asset_native import REGISTRY


def sha(data):
    return hashlib.sha256(data).hexdigest()


def initialize_original_ui_shared_constants(n, backend, fields_file, registration_files):
    fields_raw = Path(fields_file).read_bytes()
    request = json.loads(fields_raw)
    if (request["kind"] != "original-shared-shader-typed-field-inputs" or
            request["build"] != "16.21.829.8620" or request["protocol"] != "20e09df23c66b85e"):
        raise ValueError("Exact original Shared declarations/registration source required")
    if not registration_files:
        raise ValueError("Explicit original Shared registration sources required")
    inputs = {**request["inputs"], str(Path(fields_file).resolve()): sha(fields_raw)}
    records = []
    for filename in registration_files:
        registration_raw = Path(filename).read_bytes()
        registration = json.loads(registration_raw)
        if (registration["kind"] != "original-reflection-registration-source-candidates" or
                registration["decoderImageSha256"] != sha(n.image)):
            raise ValueError("Exact original Shared registration image required")
        inputs[str(Path(filename).resolve())] = sha(registration_raw)
        records.extend(registration["records"])
    for path, expected in inputs.items():
        if sha(Path(path).read_bytes()) != expected:
            raise ValueError("Original Shared field-input provenance changed")
    for record in records:
        if len(record["candidates"]) != 1:
            raise ValueError("Unique original Shared metadata constructor required")
        candidate = record["candidates"][0]
        pairs = [item for item in candidate["callers"] if item["staticDescriptorRva"] is not None]
        if len(pairs) > 1:
            raise ValueError("Original Shared metadata caller is ambiguous")
        if not pairs:
            continue
        caller = pairs[0]
        begin, end = caller["adjacentLeaRdiRva"], caller["callRva"] + 5
        code = n.image[begin:end]
        if (len(code) != 12 or code[:3] != bytes.fromhex("488d3d") or code[7] != 0xE8 or
                sha(code) != caller["pairSha256"] or code != n.source.image[begin:end] or
                end + struct.unpack_from("<i", code, 8)[0] != candidate["candidateFramePrologueRva"] or
                begin + 7 + struct.unpack_from("<i", code, 3)[0] != caller["staticDescriptorRva"]):
            raise ValueError("Original Shared metadata LEA/CALL differs")
        if int(record["classHash"], 16) not in n.types:
            n.call(begin, {}, end)
        count, array = n.u32(n.base + REGISTRY + 8), n.q(n.base + REGISTRY)
        if not 0 < count <= 4096:
            raise ValueError("Original Shared metadata registry escaped bounds")
        types = {}
        for index in range(count):
            pointer = n.q(array + index * 8)
            if not n.base + 0x1FEF000 <= pointer <= n.base + len(n.image) - 0x88 or n.u32(pointer + 8) in types:
                raise ValueError("Original Shared metadata class is duplicated or unowned")
            types[n.u32(pointer + 8)] = pointer
        n.types = types
        if n.types.get(int(record["classHash"], 16)) != n.base + caller["staticDescriptorRva"]:
            raise ValueError("Original Shared class publication differs")
    n.type_catalog = n.catalog()
    if any(identity not in n.type_catalog for identity in ["0125d45c", "95ef430a"]):
        raise ValueError("Original Shared constant/buffer classes remain unregistered")
    constant_type, buffer_type = n.type_catalog["0125d45c"], n.type_catalog["95ef430a"]
    vector_fields = [item for item in buffer_type["properties"] if item["hash"] == 0xADB3E562]
    if len(vector_fields) != 1 or vector_fields[0]["type"] != 128 or constant_type["size"] != 56:
        raise ValueError("Original Shared constant vector layout differs")
    table = n.q(backend)
    methods = {}
    for offset, expected in [(0x268, 0x1913B10), (0x2B8, 0x19139E0), (0x2D8, 0x1928420)]:
        original = n.q(n.base + 0x2408570 + offset)
        if original != n.base + expected:
            raise ValueError("Original UI constant virtual identity differs")
        n.put(table + offset, "Q", original)
        methods[offset] = expected
    rows, roots = [], []
    for identity in ["6500c3ef", "75055a4d"]:
        selected = [item for item in request["roots"] if item["ownerPathHash"] == identity]
        if len(selected) != 1 or selected[0]["classHash"] != "95ef430a":
            raise ValueError("Exact authored UI constant-buffer definition required")
        root = selected[0]
        source = Path(root["source"]["file"])
        raw = source.read_bytes()
        if (len(raw) != root["source"]["bytes"] or sha(raw) != root["source"]["sha256"] or
                sha(raw) != "b8b9ced72938a29f86468931a8c147c74515d74b8cc067cf902cbc0bd018a402"):
            raise ValueError("Original archived Shared source bytes differ")
        inputs[str(source.resolve())] = sha(raw)
        fields = []
        for span in root["fields"]:
            begin, size = span["offset"], span["bytes"]
            data = raw[begin:begin + size]
            if (begin < 0 or size < 5 or len(data) != size or sha(data) != span["sha256"] or
                    int.from_bytes(data[:4], "little") != int(span["fieldHash"], 16)):
                raise ValueError("Original UI Shared field span differs")
            fields.append(data)
        read = n.observe_actor_fields(0x95EF430A, fields)
        roots.append({"pathHash": identity, "originalRead": read})
        if read["originalSkippedFields"] or read["pendingReferences"]:
            raise ValueError("UI Shared definition retains skipped fields or unresolved links")
        for pointer in n.vector(read["object"] + vector_fields[0]["offset"], constant_type["size"], 8):
            name_pointer, length = n.q(pointer), n.u32(pointer + 8)
            if not 0 < length <= 128 or not n.library_pointer(name_pointer, length):
                raise ValueError("Original UI constant name escaped bounds")
            name = bytes(n.u.mem_read(name_pointer, length)).decode("ascii")
            if name not in ["UI_ELEMENT_MATRIX", "UI_USER_PARAMS", "UI_COLOR"]:
                raise ValueError("Unexpected original UI constant definition")
            n.call(methods[0x268], {r.UC_X86_REG_RDI: backend, r.UC_X86_REG_RSI: name_pointer})
            if n.u.reg_read(r.UC_X86_REG_RAX):
                raise ValueError("UI constant registration requires its original cold name")
            n.call(methods[0x2B8], {r.UC_X86_REG_RDI: backend, r.UC_X86_REG_RSI: pointer})
            n.call(methods[0x268], {r.UC_X86_REG_RDI: backend, r.UC_X86_REG_RSI: name_pointer})
            view = n.u.reg_read(r.UC_X86_REG_RAX)
            if n.allocations.get(view) != 0x38:
                raise ValueError("Original UI constant consumer did not publish its own view")
            rows.append({"name": name, "originalDefinition": pointer, "view": view,
                         "originalDefinitionHex": bytes(n.u.mem_read(pointer, constant_type["size"])).hex(),
                         "viewHex": bytes(n.u.mem_read(view, 0x38)).hex()})
    if sorted(row["name"] for row in rows) != ["UI_COLOR", "UI_ELEMENT_MATRIX", "UI_USER_PARAMS"]:
        raise ValueError("Exact complete UI constant set required")
    missing = n.allocate_text("SCOUT_UNREGISTERED_UI_CONSTANT_CONTROL")
    n.call(methods[0x268], {r.UC_X86_REG_RDI: backend, r.UC_X86_REG_RSI: missing})
    if n.u.reg_read(r.UC_X86_REG_RAX):
        raise ValueError("Unknown original constant unexpectedly resolved")
    for path, expected in inputs.items():
        if sha(Path(path).read_bytes()) != expected:
            raise ValueError("Original UI constant input changed")
    return {"inputs": inputs, "roots": roots, "rows": rows, "unregisteredNameResult": 0,
            "originalMethods": {hex(key): value for key, value in methods.items()},
            "scope": {"originalNamedCpuViewsPublished": True, "constantBuffersPublished": False,
                      "gpuUniformsUploaded": False, "nativeUiSceneAdmitted": False}}
