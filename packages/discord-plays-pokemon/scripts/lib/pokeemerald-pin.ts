// Single source of truth for the pokeemerald-wasm source pin: the OTTOHG_SHA
// in scripts/build-wasm.sh, advanced by Renovate's git-refs custom manager
// (renovate.json). The data generators read the pin from here so the derived
// species/map tables can never drift to a different revision than the wasm
// the emulator actually runs.

const BUILD_WASM_SH = new URL("../build-wasm.sh", import.meta.url);

export async function readOttohgSha(): Promise<string> {
  const source = await Bun.file(BUILD_WASM_SH).text();
  const match = /^OTTOHG_SHA="([0-9a-f]{40})"$/m.exec(source);
  const sha = match?.[1];
  if (sha === undefined) {
    throw new Error(
      `OTTOHG_SHA="<40-hex>" not found in ${BUILD_WASM_SH.pathname}`,
    );
  }
  return sha;
}
