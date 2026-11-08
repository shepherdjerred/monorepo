"""Extract static default attack-name formatting from the exact native client.

Runs only the original formatter-selection prefix, stopping before snprintf.
No replay, game handler, character registry or operating-system import runs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as reg


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_text())
    image = (args.package / "image.bin").read_bytes()
    if (profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
            or hashlib.sha256(image).hexdigest() != profile["decoderImageSha256"]):
        raise ValueError("Attack-name formatter executable mismatch")
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x10000)
    initial = engine.context_save()
    observations = []

    def before_format(uc, address, size, _):
        pointer = uc.reg_read(reg.UC_X86_REG_RDX)
        raw = bytes(uc.mem_read(pointer, 128)).split(b"\0", 1)[0]
        text = raw.decode("ascii")
        if text not in ["%sBasicAttack", "%sBasicAttack%i", "%sCritAttack", "%sCritAttack%i"]:
            raise ValueError("Unrecognized original attack-name format")
        if uc.reg_read(reg.UC_X86_REG_RCX) != 0x10003000:
            raise ValueError("Formatter no longer receives the character name")
        observations.append({"format": text, "number": uc.reg_read(reg.UC_X86_REG_R8D) if "%i" in text else None,
                             "formatRva": pointer-base})
        uc.emu_stop()

    engine.hook_add(unicorn.UC_HOOK_CODE, before_format, begin=base+0x142cb30, end=base+0x142cb30)
    defaults = {}
    for index in range(18):
        engine.context_restore(initial)
        engine.mem_write(0x10000000, bytes(0x10000))
        engine.mem_write(0x10001040, (0x10003000).to_bytes(8,"little"))
        engine.mem_write(0x10003000, b"Character\0")
        engine.reg_write(reg.UC_X86_REG_RBX, 0x10001000)
        engine.reg_write(reg.UC_X86_REG_RSI, index)
        engine.reg_write(reg.UC_X86_REG_RBP, 0x10008000)
        engine.reg_write(reg.UC_X86_REG_RSP, 0x10007000)
        before = len(observations)
        engine.emu_start(base+0x2b6fbf, base+0x2b711f, count=10000)
        if len(observations) != before+1:
            raise ValueError("Native default attack-name path did not reach formatter")
        defaults[str(64+index)] = observations[-1]
    result = {"schema":1,"clientVersion":profile["clientVersion"],"sliceSha256":profile["sliceSha256"],
              "decoderImageSha256":profile["decoderImageSha256"],"entryRva":0x2b6fbf,
              "stopRva":0x142cb30,"defaults":defaults,
              "scope":"Original default name selection only; character-record overrides and runtime replacements are separate"}
    output = args.package / "attack-names.json"
    output.write_text(json.dumps(result,indent=2),encoding="utf-8")
    profile["attackNamingSha256"] = hashlib.sha256(output.read_bytes()).hexdigest()
    (args.package / "profile.json").write_text(json.dumps(profile,indent=2),encoding="utf-8")
    print(json.dumps({"defaults":defaults,"sha256":profile["attackNamingSha256"]}))


if __name__ == "__main__":
    main()
