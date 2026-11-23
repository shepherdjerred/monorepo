"""Execute the 16.23.840.6595 CPU terrain-fog raster with controlled grid bytes."""

import argparse
import hashlib
import json
import struct
from pathlib import Path

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as reg


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Raster:
    ENTRY = 0x223960
    END = 0x223C56
    LOOKUP = 0x2137110
    GRAPHICS = 0x180C200
    UPLOAD = 0x180C220
    ALLOCATE = 0x14A2030
    FREE = 0x14A46F0
    COPY = 0x14C55B0
    SCRATCH = 0x70000000
    GRID = SCRATCH + 0x1000
    CELLS = SCRATCH + 0x10000
    TEXTURE = SCRATCH + 0x3000
    VTABLE = SCRATCH + 0x4000
    DESCRIPTOR = SCRATCH + 0x5000
    GET_DESCRIPTOR = SCRATCH + 0x6000
    PIXELS = SCRATCH + 0x14000
    STACK = SCRATCH + 0x56000
    RETURN = SCRATCH + 0x57000

    def __init__(self, image, side, cells, poison=0xCD):
        if not 2 <= side <= 128 or len(cells) != side * side:
            raise ValueError("Expected a square control grid, 2-128 cells per side")
        self.image = image
        self.width = side * 4
        self.size = self.width * self.width
        self.poison = poison
        self.u = Uc(UC_ARCH_X86, UC_MODE_64)
        self.u.mem_map(image.base, len(image.image))
        self.u.mem_write(image.base, bytes(image.image))
        self.u.mem_map(self.SCRATCH, 0x58000)
        self.u.mem_write(self.SCRATCH, struct.pack("<QQ", self.GRID, self.TEXTURE))
        self.u.mem_write(self.GRID + 0x1C, struct.pack("<IQQ", side, 0, self.CELLS))
        self.u.mem_write(self.CELLS, cells)
        self.u.mem_write(self.TEXTURE, struct.pack("<Q", self.VTABLE))
        self.u.mem_write(self.VTABLE + 8, struct.pack("<Q", self.GET_DESCRIPTOR))
        self.u.mem_write(self.DESCRIPTOR + 8, struct.pack("<HH", self.width, self.width))
        self.u.mem_write(self.STACK, struct.pack("<Q", self.RETURN))
        self.u.reg_write(reg.UC_X86_REG_RSP, self.STACK)
        self.u.reg_write(reg.UC_X86_REG_RDI, self.SCRATCH)
        self.u.reg_write(reg.UC_X86_REG_XMM0, 0x3F800000)
        self.bytes = None
        self.calls = []
        for rva, callback in {
            self.GRAPHICS: self.texture,
            self.UPLOAD: self.upload,
            self.ALLOCATE: self.allocate,
            self.FREE: self.free,
            self.COPY: self.copy,
        }.items():
            address = self.image.base + rva
            self.u.hook_add(UC_HOOK_CODE, callback, begin=address, end=address)
        self.u.hook_add(UC_HOOK_CODE, self.descriptor,
                        begin=self.GET_DESCRIPTOR, end=self.GET_DESCRIPTOR)

    def argument(self, index):
        return self.u.reg_read((reg.UC_X86_REG_RDI, reg.UC_X86_REG_RSI, reg.UC_X86_REG_RDX,
                                reg.UC_X86_REG_RCX, reg.UC_X86_REG_R8, reg.UC_X86_REG_R9)[index])

    def return_value(self, value=0):
        stack = self.u.reg_read(reg.UC_X86_REG_RSP)
        target, = struct.unpack("<Q", self.u.mem_read(stack, 8))
        self.u.reg_write(reg.UC_X86_REG_RSP, stack + 8)
        self.u.reg_write(reg.UC_X86_REG_RAX, value)
        self.u.reg_write(reg.UC_X86_REG_RIP, target)

    def texture(self, *_):
        self.calls.append("texture")
        self.return_value(self.TEXTURE)

    def descriptor(self, *_):
        assert self.argument(0) == self.TEXTURE
        self.return_value(self.DESCRIPTOR)

    def allocate(self, *_):
        assert self.argument(0) == self.size
        self.calls.append("allocate")
        self.u.mem_write(self.PIXELS, bytes([self.poison]) * self.size)
        self.return_value(self.PIXELS)

    def copy(self, *_):
        dest, length, source, count = [self.argument(i) for i in range(4)]
        assert length == count == self.width
        assert self.PIXELS <= dest <= self.PIXELS + self.size - count
        assert self.PIXELS <= source <= self.PIXELS + self.size - count
        self.calls.append("copy")
        self.u.mem_write(dest, bytes(self.u.mem_read(source, count)))
        self.return_value()

    def upload(self, *_):
        assert [self.argument(i) for i in range(6)] == [
            self.TEXTURE, 0, 0, self.width, self.width, 0,
        ]
        source, = struct.unpack("<Q", self.u.mem_read(
            self.u.reg_read(reg.UC_X86_REG_RSP) + 8, 8))
        assert source == self.PIXELS
        self.calls.append("upload")
        self.bytes = bytes(self.u.mem_read(source, self.size))
        self.return_value()

    def free(self, *_):
        assert self.argument(0) == self.PIXELS
        self.calls.append("free")
        self.return_value()

    def run(self):
        self.u.emu_start(self.image.base + self.ENTRY, self.RETURN, count=12_000_000)
        assert self.u.reg_read(reg.UC_X86_REG_RIP) == self.RETURN
        assert self.calls == ["texture", "allocate", *["copy"] * 4, "upload", "free"]
        assert bytes(self.u.mem_read(self.SCRATCH + 0x2C, 4)) == struct.pack("<f", 1.0)
        return self.bytes

    def resource_selection(self):
        """Observe resource and sampler writes before the native release and uniforms."""
        base = self.image.base
        view = self.SCRATCH + 0x7000
        default_owner = self.SCRATCH + 0x8000
        selected_owner = self.SCRATCH + 0x9000
        default_wrapper = self.SCRATCH + 0xA000
        selected_wrapper = self.SCRATCH + 0xB000
        texture_get = self.SCRATCH + 0xC000
        sampler_apply = self.SCRATCH + 0xD000
        default_resource = self.SCRATCH + 0xE000
        selected_resource = self.SCRATCH + 0xF000

        def pointer(address, value):
            self.u.mem_write(address, struct.pack("<Q", value))

        def get_resource(*_):
            wrapper = self.argument(0)
            assert wrapper in [default_wrapper, selected_wrapper]
            self.return_value(default_resource if wrapper == default_wrapper else selected_resource)

        def apply_sampler(*_):
            assert self.argument(0) == view
            self.return_value()

        pointer(base + 0x24E5E00, default_owner)
        pointer(base + 0x250D100, self.SCRATCH)
        pointer(base + 0x25D5FE0, view)
        pointer(default_owner + 0xA0, default_wrapper)
        pointer(self.SCRATCH + 0x20, selected_owner)
        pointer(selected_owner + 0x20, selected_wrapper)
        pointer(default_wrapper, self.VTABLE)
        pointer(selected_wrapper, self.VTABLE)
        pointer(view, self.VTABLE)
        pointer(self.VTABLE + 8, texture_get)
        pointer(self.VTABLE + 0x10, sampler_apply)
        hooks = [
            self.u.hook_add(UC_HOOK_CODE, get_resource, begin=texture_get, end=texture_get),
            self.u.hook_add(UC_HOOK_CODE, apply_sampler, begin=sampler_apply, end=sampler_apply),
        ]
        rows = []
        try:
            for disabled, expected in [(False, selected_resource), (True, default_resource),
                                       (False, selected_resource)]:
                self.u.mem_write(base + 0x250D0F8, bytes([disabled]))
                self.u.reg_write(reg.UC_X86_REG_RSP, self.STACK)
                self.u.emu_start(base + 0x220D60, base + 0x220DF8, count=1000)
                assert self.u.reg_read(reg.UC_X86_REG_RIP) == base + 0x220DF8
                resource, = struct.unpack("<Q", self.u.mem_read(view + 8, 8))
                assert resource == expected
                sampler = bytes(self.u.mem_read(view + 0x10, 12))
                assert sampler == bytes.fromhex("010100010100000000000000")
                rows.append({"disabled": disabled, "selectedControllerResource":
                             resource == selected_resource, "nativeViewSamplerHex": sampler.hex()})
        finally:
            for hook in hooks:
                self.u.hook_del(hook)
        return rows

    def perspective_selection(self):
        """Exercise native team publications and invalidation on supplied owners."""
        base = self.image.base
        camera = self.SCRATCH + 0x7000
        controller = self.SCRATCH + 0x8000
        self.u.mem_write(base + 0x250D100, struct.pack("<Q", controller))
        self.u.mem_write(base + 0x250D108, struct.pack("<Q", self.GRID))
        sentinel, = self.u.mem_read(base + 0x25E0010, 1)

        def call(entry, stop, first=0, second=0):
            self.u.reg_write(reg.UC_X86_REG_RSP, self.STACK)
            self.u.reg_write(reg.UC_X86_REG_RDI, first)
            self.u.reg_write(reg.UC_X86_REG_RSI, second)
            self.u.emu_start(base + entry, stop, count=1000)
            assert self.u.reg_read(reg.UC_X86_REG_RIP) == stop
            return self.u.reg_read(reg.UC_X86_REG_RAX) & 255

        def capture(choice, slot, enabled):
            publication = bytes(self.u.mem_read(base + 0x25D5FB8, 2))
            assert publication == bytes([enabled, slot])
            disabled, = self.u.mem_read(base + 0x250D0F8, 1)
            assert disabled == int(not enabled)
            return {"choice": choice, "enabled": enabled, "publishedSlot": slot,
                    "disableByte": disabled}

        call(0xF23C00, base + 0xF23C72, camera, 0)
        rows = [capture("all", sentinel, False)]
        for team, expected_slot in [(100, 1), (200, 2), (100, 1)]:
            slot = call(0x6DE3C0, self.RETURN, team)
            assert slot == expected_slot
            self.u.mem_write(self.GRID + 0x30, bytes(1))
            self.u.mem_write(controller + 0x28, struct.pack("<Q", 1234))
            self.u.mem_write(controller + 0x30, bytes(1))
            call(0xF238F0, base + 0xF23946, camera, slot)
            assert bytes(self.u.mem_read(camera + 0x1DC, 1)) == bytes([slot])
            assert bytes(self.u.mem_read(self.GRID + 0x30, 1)) == b"\1"
            assert bytes(self.u.mem_read(controller + 0x28, 9)) == bytes(8) + b"\1"
            rows.append(capture(team, slot, True))
        call(0xF23C00, base + 0xF23C72, camera, 0)
        rows.append(capture("all", sentinel, False))
        call(0xF23C00, base + 0xF23C3D, camera, 1)
        rows.append(capture("restored", 1, True))
        return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["binary", "replay", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    binary = args.binary.read_bytes()
    replay_sha = sha(args.replay.read_bytes())
    binary_sha = sha(binary)
    if (binary_sha != "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
            or replay_sha != "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668"):
        raise ValueError("Expected the archived build and long replay used by the world mask proof")
    image = MachImage(binary)
    lookup = bytes(image.image[Raster.LOOKUP:Raster.LOOKUP + 256])
    assert bytes(image.image[0x2255A8B:0x2255A93]) == b"FOW_MAP\0"
    stages = []
    for rva, expected in [
        (0x2255B3F, "Fade.ps"),
        (0x2255BAD, "FastSeparableGaussianBlur.ps"),
        (0x2255C05, "ApplyOverlayAndColor.ps"),
    ]:
        shader = bytes(image.image[rva:rva + 128]).split(b"\0", 1)[0]
        assert shader.decode("ascii") == f"ASSETS/Shaders/HLSL/FogOfWar/{expected}"
        stages.append({"nameRva": rva, "path": shader.decode("ascii"), "nameSha256": sha(shader)})
    records = []
    for index in range(16):
        cells = bytes(129 if (index >> i) & 1 else 128 for i in range(4))
        pixels = Raster(image, 2, cells).run()
        expected = lookup[16 * index:16 * (index + 1)]
        # For a 2x2 grid the four-cell lookup fills the center of an 8x8 texture.
        # Native border writes extend by two on each edge, leaving corner blocks untouched.
        edge = [0, 0, 0, 1, 2, 3, 3, 3]
        assert pixels == bytes(
            0xCD if (x < 2 or x >= 6) and (z < 2 or z >= 6)
            else expected[edge[z] * 4 + edge[x]]
            for z in range(8) for x in range(8)
        )
        records.append({"case": index, "cellsHex": cells.hex(), "pixelsHex": pixels.hex(),
                        "pixelsSha256": sha(pixels)})
    controls = []
    for value in [0, 255]:
        for poison in [0xCD, 0xBA]:
            pixels = Raster(image, 3, bytes([value]) * 9, poison=poison).run()
            assert pixels == bytes(
                poison if (x < 2 or x >= 10) and (z < 2 or z >= 10) else value
                for z in range(12) for x in range(12)
            )
            controls.append({"gridByte": value, "initialAllocationByte": poison,
                             "pixelsSha256": sha(pixels)})
    result = {
        "schema": 1,
        "kind": "exact-build-controlled-terrain-fog-raster",
        "build": "16.23.840.6595",
        "protocol": "8bbfcd5af2bc92db",
        "binarySha256": binary_sha,
        "replaySha256": replay_sha,
        "producerSha256": sha(Path(__file__).read_bytes()),
        "raster": {"rva": Raster.ENTRY, "endExclusiveRva": Raster.END,
                   "sha256": sha(image.image[Raster.ENTRY:Raster.END]),
                   "gridPlaneOffset": 0x28, "scale": 4, "cornerThreshold": 129,
                   "lookupRva": Raster.LOOKUP, "lookupSha256": sha(lookup),
                   "lookupHex": lookup.hex(), "edgeExtensionTexels": 2,
                   "unwrittenCornerBlockSide": 2, "records": records,
                   "uniformThreeCellControls": controls},
        "resourceSource": {
            "resourceName": "FOW_MAP", "nameAcquisitionRva": 0x220C40,
            "selectorRva": 0x220D60, "controllerGlobalRva": 0x250D100,
            "disabledGlobalRva": 0x250D0F8, "namedViewGlobalRva": 0x25D5FE0,
            "selectedControllerPointerOffsets": [0x20, 0x20],
            "samplerBindRva": 0x195EEA0, "samplerArgumentWords": [1, 1, 0, 0, 1, 1],
            "selectorPrefixSha256": sha(image.image[0x220D60:0x220E00]),
            "nameAcquisitionSha256": sha(image.image[0x220C40:0x220CF1]),
            "nativeSamplerBindSha256": sha(image.image[0x195EEA0:0x195EF33]),
            "controlledResourceSelection": Raster(image, 2, bytes(4)).resource_selection(),
            "nativePostProcessStages": stages,
        },
        "teamSource": {
            "teamSelectionRva": 0xF238F0, "fogToggleRva": 0xF23C00,
            "filterEnabledGlobalRva": 0x25D5FB8, "selectedSlotGlobalRva": 0x25D5FB9,
            "resetDirtyRva": 0x221030, "worldGridGlobalRva": 0x250D108,
            "worldGridReadRva": 0x221070, "gridTickRva": 0x2205C0,
            "gridProviderWalkRva": 0x221900,
            "controlledPerspectiveSelection": Raster(image, 2, bytes(4)).perspective_selection(),
        },
        "scope": {"nativeCpuRasterExecuted": True, "controlledGridBytes": True,
                  "recordedGridRestored": False, "nativeGraphicsUploadExecuted": False,
                  "nativePostProcessExecuted": False,
                  "terrainShadingAdmitted": False},
    }
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, indent=2)


if __name__ == "__main__":
    main()
