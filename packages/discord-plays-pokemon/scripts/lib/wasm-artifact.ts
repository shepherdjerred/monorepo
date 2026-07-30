const MINIMUM_POKEMON_WASM_BYTES = 1024 * 1024;
const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00] as const;

export async function writeWasmArtifact(
  source: string,
  output: string,
): Promise<void> {
  const sourceFile = Bun.file(source);
  if (!(await sourceFile.exists())) {
    throw new Error(`WASM build did not produce an artifact: ${source}`);
  }
  if (sourceFile.size < MINIMUM_POKEMON_WASM_BYTES) {
    throw new Error(
      `WASM artifact is unexpectedly small: ${sourceFile.size.toString()} bytes`,
    );
  }
  const header = new Uint8Array(
    await sourceFile.slice(0, WASM_HEADER.length).arrayBuffer(),
  );
  if (!WASM_HEADER.every((byte, index) => header[index] === byte)) {
    throw new Error(`WASM artifact has an invalid header: ${source}`);
  }
  await Bun.write(output, Bun.file(source), { createPath: true });
  if (Bun.file(output).size !== sourceFile.size) {
    throw new Error(`WASM artifact copy is incomplete: ${output}`);
  }
}
