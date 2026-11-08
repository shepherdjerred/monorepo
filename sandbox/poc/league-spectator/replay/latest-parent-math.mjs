// Original cold-file math code with explicit, bounded ABI and AVX lowering.
import { sha256 } from "./structural-comparison.mjs";
import { installMathIsa } from "./latest-math-isa.mjs";

export const PARENT_MATH_SHA =
  "f78b7342633bf122602a716dab33a9b3a367b2ee8f0744fb54700f60167e1f3d";

export async function loadParentMath(packageBytes, loadBytes) {
  if ((await sha256(packageBytes)) !== PARENT_MATH_SHA)
    throw Error("Parent math package hash differs");
  const catalog = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    catalog.build !== "16.21.829.8620" ||
    catalog.protocol !== "20e09df23c66b85e" ||
    catalog.source.preferredBase !== 0x180000000 ||
    !catalog.scope.interruptBasedIsaLowering ||
    catalog.scope.windowsImportsProvided
  )
    throw Error("Unsupported parent math scope");
  const loaded = [];
  for (const part of [catalog.image, catalog.trampolines]) {
    if (!/^(image|abi)-[a-f0-9]{64}\.bin$/.test(part.file))
      throw Error("Invalid math image filename");
    const bytes = new Uint8Array(await loadBytes(part.file));
    if (bytes.length !== part.bytes || (await sha256(bytes)) !== part.sha256)
      throw Error("Parent math image hash/size differs");
    loaded.push(bytes);
  }
  return { catalog, image: loaded[0], trampolines: loaded[1] };
}

export function installParentMath(
  uc,
  engine,
  prepared,
  { preserveImportRegisters = false } = {},
) {
  const { catalog, image, trampolines } = prepared,
    base = catalog.source.preferredBase;
  engine.mem_map(base, image.length, uc.PROT_ALL);
  engine.mem_write(base, image);
  engine.mem_protect(base, image.length, uc.PROT_READ);
  for (const region of catalog.image.executableRegions)
    engine.mem_protect(
      base + region.rva,
      region.bytes,
      uc.PROT_READ | uc.PROT_EXEC,
    );
  engine.mem_map(catalog.trampolines.base, trampolines.length, uc.PROT_ALL);
  engine.mem_write(catalog.trampolines.base, trampolines);
  engine.mem_protect(
    catalog.trampolines.base,
    trampolines.length,
    uc.PROT_READ | uc.PROT_EXEC,
  );
  const isa = installMathIsa(uc, engine, catalog);
  const context = preserveImportRegisters ? engine.context_alloc() : null;
  if (preserveImportRegisters)
    engine.mem_map(0x31000000, 0x10000, uc.PROT_READ | uc.PROT_WRITE);
  let active;
  if (preserveImportRegisters)
    for (const [name, entry] of Object.entries(catalog.trampolines.entries)) {
      const address = catalog.trampolines.base + entry.returnOffset;
      engine.hook_add(
        uc.HOOK_CODE,
        () => {
          if (active !== name) throw Error("Unowned parent math return");
          const raw = engine.reg_read(uc.X86_REG_XMM0, 16),
            output = new Uint8Array(16);
          output.set(raw.slice(0, entry.resultWidth * 4));
          const view = new DataView(output.buffer);
          for (let i = 0; i < entry.resultWidth; i++)
            if (!Number.isFinite(view.getFloat32(i * 4, true)))
              throw Error("Non-finite native parent math result");
          // The native reference's host-import boundary preserves all registers
          // except a zero-filled XMM0 result. This is that explicit boundary, not a
          // claim about the unobserved macOS libm's volatile-register contents.
          engine.context_restore(context);
          engine.reg_write(uc.X86_REG_XMM0, output);
          engine.reg_write_i64(
            uc.X86_REG_RIP,
            BigInt(catalog.trampolines.base + entry.offset + entry.bytes - 1),
          );
          active = undefined;
        },
        null,
        address,
        address,
      );
    }
  return {
    isa,
    assertIdle() {
      if (active !== undefined) throw Error("Active parent math import");
    },
    route(name) {
      const entry = catalog.trampolines.entries[name];
      if (!entry) throw Error(`Unprepared native math import: ${name}`);
      if (preserveImportRegisters) {
        if (active !== undefined) throw Error("Reentrant parent math import");
        engine.context_save(context);
        active = name;
        // Win64 shadow space and kernel locals must not overwrite the modeled
        // SysV import's caller stack or a modff output stored there.
        engine.mem_write(0x3100ff08, new Uint8Array(8));
        engine.reg_write_i64(uc.X86_REG_RSP, 0x3100ff08n);
      }
      engine.reg_write_i64(
        uc.X86_REG_RIP,
        BigInt(catalog.trampolines.base + entry.offset),
      );
    },
    close() {
      if (context !== null) engine.context_free(context);
    },
  };
}
