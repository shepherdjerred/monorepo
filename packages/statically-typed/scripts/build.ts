import { mkdir, rm } from "node:fs/promises";

const packageRoot = new URL("../", import.meta.url);
const sourceRoot = new URL("src/", packageRoot);
export const distRoot = new URL("dist/", packageRoot);
export const fontSource = new URL(
  "../scout-for-lol/packages/design-system/assets/fonts/BerkeleyMono/BerkeleyMono-Regular.woff2",
  packageRoot,
);

export async function buildSite(
  outputRoot: URL = distRoot,
  fontInput: URL = fontSource,
): Promise<void> {
  const font = new Uint8Array(await Bun.file(fontInput).arrayBuffer());
  if (
    font.byteLength < 48 ||
    new TextDecoder().decode(font.subarray(0, 4)) !== "wOF2" ||
    new DataView(font.buffer).getUint32(8) !== font.byteLength
  ) {
    throw new Error("Berkeley Mono input must be a complete WOFF2 font");
  }

  const files = ["index.html", "404.html", "styles.css"];
  const contents = await Promise.all(
    files.map((file) => Bun.file(new URL(file, sourceRoot)).arrayBuffer()),
  );
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(new URL("fonts/", outputRoot), { recursive: true });
  for (const [index, file] of files.entries()) {
    const content = contents[index];
    if (content === undefined) throw new Error(`Missing build input: ${file}`);
    await Bun.write(new URL(file, outputRoot), content);
  }
  await Bun.write(
    new URL("fonts/BerkeleyMono-Regular.woff2", outputRoot),
    font,
  );
}

if (import.meta.main) {
  await buildSite();
  process.stdout.write("Built Statically Typed → dist/\n");
}
