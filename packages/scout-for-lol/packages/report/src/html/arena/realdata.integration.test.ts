import { test, expect } from "bun:test";
import { arenaMatchToSvg } from "@scout-for-lol/report/html/arena/index.tsx";
import { ArenaMatchSchema } from "@scout-for-lol/data";
import { svgToPng } from "@scout-for-lol/report/html/index.tsx";

function hashSvg(svg: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(svg);
  return hasher.digest("hex");
}

const currentDir = new URL(".", import.meta.url).pathname;

const RAW_FILE_PATHS = [
  `${currentDir}testdata/1.json`,
  `${currentDir}testdata/2.json`,
];

for (const path of RAW_FILE_PATHS) {
  const fileNameOrUndefined = path.split("/").pop();
  if (!fileNameOrUndefined) {
    throw new Error("fileName is undefined");
  }
  const fileName: string = fileNameOrUndefined;
  const testName = `arena real data renders image for ${fileName}`;
  test(testName, async () => {
    const match = (await Bun.file(path).json()) as unknown;
    const svg = await arenaMatchToSvg(ArenaMatchSchema.parse(match));
    const png = await svgToPng(svg);
    const outputFileName: string =
      path.split("/").pop()?.replace(".json", ".png") ?? "arena_real.png";
    await Bun.write(
      new URL(`__snapshots__/${outputFileName}`, import.meta.url),
      png,
    );
    await Bun.write(
      new URL(
        `__snapshots__/${outputFileName.replace(".png", ".svg")}`,
        import.meta.url,
      ),
      svg,
    );

    // Now that assets are cached locally, SVG output is deterministic
    const svgHash = hashSvg(svg);
    expect(svgHash).toMatchSnapshot();
  });
}
