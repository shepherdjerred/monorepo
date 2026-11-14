// Regenerates the committed application icons from the design-system brand
// mark. Run on macOS (it uses `sips` and `iconutil`) after the mark changes:
//   bun scripts/build-icons.ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "../design-system/assets/brand/app-icon-512.png");

async function run(command: string[]): Promise<void> {
  const process = Bun.spawn(command, { stdout: "ignore", stderr: "inherit" });
  if ((await process.exited) !== 0) {
    throw new Error(`${command.join(" ")} failed`);
  }
}

async function resized(directory: string, size: number): Promise<Buffer> {
  const output = join(directory, `${size}.png`);
  await run([
    "sips",
    "-z",
    String(size),
    String(size),
    source,
    "--out",
    output,
  ]);
  return Buffer.from(await readFile(output));
}

// A PNG-compressed ICO: Windows Vista and later read 256px entries as PNG.
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  for (const [index, { size, png }] of images.entries()) {
    const at = 6 + index * 16;
    header[at] = size % 256;
    header[at + 1] = size % 256;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  }
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

const scratch = await mkdtemp(join(tmpdir(), "scout-icons-"));
try {
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of icoSizes) {
    images.push({ size, png: await resized(scratch, size) });
  }
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "assets/icon.ico"), ico(images));

  const iconset = join(scratch, "icon.iconset");
  await mkdir(iconset);
  for (const [name, size] of [
    ["icon_16x16", 16],
    ["icon_16x16@2x", 32],
    ["icon_32x32", 32],
    ["icon_32x32@2x", 64],
    ["icon_128x128", 128],
    ["icon_128x128@2x", 256],
    ["icon_256x256", 256],
    ["icon_256x256@2x", 512],
    ["icon_512x512", 512],
  ] as const) {
    await writeFile(join(iconset, `${name}.png`), await resized(scratch, size));
  }
  await run([
    "iconutil",
    "-c",
    "icns",
    iconset,
    "-o",
    join(root, "assets/icon.icns"),
  ]);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
