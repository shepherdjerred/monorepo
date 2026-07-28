export async function writeWasmArtifact(
  source: string,
  output: string,
): Promise<void> {
  await Bun.write(output, Bun.file(source), { createPath: true });
}
