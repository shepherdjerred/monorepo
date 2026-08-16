import { strict as assert } from "node:assert";
import { relative, resolve } from "node:path";

type Dimensions = {
  width: number;
  height: number;
};

const reportRoot = resolve(import.meta.dir, "..");
const manifestPath = resolve(reportRoot, "visual-contract/manifest.json");
const shouldWrite = Bun.argv.includes("--write");

const outputRoots = [
  "src/html/__snapshots__",
  "src/html/arena/__snapshots__",
  "src/html/loading-screen/__snapshots__",
  "src/html/ranked-banner/__snapshots__",
  "src/html/ranked-square/__snapshots__",
  "test-output/analytics-chart",
  "test-output/competition-chart",
  "test-output/discord-screenshot",
  "test-output/visualization-snapshot",
  "artifacts/classic",
];

const fontOrder = [
  "fonts/BeaufortForLoL-TTF/BeaufortforLOL-Light.ttf",
  "fonts/BeaufortForLoL-TTF/BeaufortforLOL-LightItalic.ttf",
  "fonts/BeaufortForLoL-TTF/BeaufortforLOL-Regular.ttf",
  "fonts/BeaufortForLoL-TTF/BeaufortforLOL-Italic.ttf",
  "fonts/BeaufortForLoL-TTF/BeaufortforLOL-Medium.ttf",
  "fonts/BeaufortForLoL-TTF/BeaufortforLOL-MediumItalic.ttf",
  "fonts/BeaufortForLoL-TTF/BeaufortforLOL-Bold.ttf",
  "fonts/BeaufortForLoL-TTF/BeaufortforLOL-BoldItalic.ttf",
  "fonts/BeaufortForLoL-TTF/BeaufortforLOL-Heavy.ttf",
  "fonts/BeaufortForLoL-TTF/BeaufortforLOL-HeavyItalic.ttf",
  "fonts/Spiegel-TTF/Spiegel_TT_Regular.ttf",
  "fonts/Spiegel-TTF/Spiegel_TT_Regular_Italic.ttf",
  "fonts/Spiegel-TTF/Spiegel_TT_SemiBold.ttf",
  "fonts/Spiegel-TTF/Spiegel_TT_SemiBold_Italic.ttf",
  "fonts/Spiegel-TTF/Spiegel_TT_Bold.ttf",
  "fonts/Spiegel-TTF/Spiegel_TT_Bold_Italic.ttf",
  "fonts/NotoSansCJK/NotoSansCJKjp-Regular.otf",
  "fonts/NotoSansCJK/NotoSansCJKkr-Regular.otf",
  "fonts/NotoSansCJK/NotoSansCJKsc-Regular.otf",
  "fonts/NotoSansCJK/NotoSansCJKtc-Regular.otf",
  "fonts/QTFrizQuad/QTFrizQuad.otf",
  "fonts/QTFrizQuad/QTFrizQuad-Bold.otf",
  "fonts/GillSans/GillSans-Regular.ttf",
  "fonts/GillSans/GillSans-Bold.ttf",
];

function sha256(data: Uint8Array | string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

function pngDimensions(bytes: Uint8Array): Dimensions {
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "Expected PNG signature",
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function svgDimensions(svg: string): Dimensions {
  const match = svg.match(/<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error("SVG is missing numeric width and height attributes");
  }
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
  };
}

function exporterFor(path: string): string {
  if (path.startsWith("src/html/loading-screen/")) {
    return "loadingScreenToSvg/loadingScreenToImage";
  }
  if (path.startsWith("src/html/ranked-banner/")) {
    return "rankedBannerToSvg/rankedBannerToImage";
  }
  if (path.startsWith("src/html/ranked-square/")) {
    return "rankedSquareToSvg/rankedSquareToImage";
  }
  if (path.startsWith("src/html/arena/")) {
    return "arenaMatchToSvg/arenaMatchToImage";
  }
  if (path.startsWith("src/html/__snapshots__/")) {
    return "matchToSvg/matchToImage";
  }
  if (path.startsWith("test-output/analytics-chart/")) {
    return "analyticsChartToImage";
  }
  if (path.startsWith("test-output/competition-chart/")) {
    return "competitionChartToImage";
  }
  if (path.startsWith("test-output/visualization-snapshot/")) {
    return "visualizationSnapshotToImage";
  }
  if (path.startsWith("test-output/discord-screenshot/")) {
    return "discordScreenshotToImage";
  }
  if (path.includes("prematch")) {
    return "loadingScreenToSvg/loadingScreenToImage (classic)";
  }
  return "classicMatchToSvg/classicMatchToImage";
}

function embeddedAssetHashes(svg: string): string[] {
  const hashes = [
    ...svg.matchAll(/data:image\/[^;]+;base64,[A-Za-z\d+/=]+/g),
  ].map((match) => sha256(match[0]));
  return [...new Set(hashes)].toSorted();
}

async function outputEntries() {
  const paths: string[] = [];
  for (const root of outputRoots) {
    for (const extension of ["svg", "png"]) {
      const glob = new Bun.Glob(`**/*.${extension}`);
      for await (const entry of glob.scan({ cwd: resolve(reportRoot, root) })) {
        paths.push(`${root}/${entry}`);
      }
    }
  }

  return Promise.all(
    paths.toSorted().map(async (path) => {
      const file = Bun.file(resolve(reportRoot, path));
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = path.endsWith(".svg") ? "svg" : "png";
      const svg =
        format === "svg" ? new TextDecoder().decode(bytes) : undefined;
      const dimensions =
        svg === undefined ? pngDimensions(bytes) : svgDimensions(svg);
      return {
        path,
        fixture: path.slice(path.lastIndexOf("/") + 1, path.lastIndexOf(".")),
        exporter: exporterFor(path),
        format,
        ...dimensions,
        sha256: sha256(bytes),
        referencedAssetSha256s:
          svg === undefined ? [] : embeddedAssetHashes(svg),
      };
    }),
  );
}

async function assetEntries() {
  const designSystemAssetsRoot = resolve(reportRoot, "../design-system/assets");
  const rankGlob = new Bun.Glob("Rank=*.png");
  const rankPaths: string[] = [];
  for await (const entry of rankGlob.scan({
    cwd: resolve(designSystemAssetsRoot, "ranks"),
  })) {
    rankPaths.push(`ranks/${entry}`);
  }
  const paths = [...fontOrder, ...rankPaths.toSorted()];
  return Promise.all(
    paths.map(async (path, order) => {
      const sourcePath = path.startsWith("fonts/")
        ? resolve(designSystemAssetsRoot, path)
        : resolve(designSystemAssetsRoot, "ranks", path.slice(6));
      const bytes = new Uint8Array(await Bun.file(sourcePath).arrayBuffer());
      return { path, order, sha256: sha256(bytes) };
    }),
  );
}

const manifest = {
  version: 1,
  renderer: {
    engine: "satori+resvg",
    contract: "exact-svg-and-png-bytes",
  },
  fontOrder,
  assets: await assetEntries(),
  outputs: await outputEntries(),
};
const serialized = `${JSON.stringify(manifest, undefined, 2)}\n`;

if (shouldWrite) {
  if (Bun.env["SCOUT_ALLOW_REPORT_BASELINE_UPDATE"] !== "1") {
    throw new Error(
      "Baseline writes require SCOUT_ALLOW_REPORT_BASELINE_UPDATE=1 and --write",
    );
  }
  await Bun.write(manifestPath, serialized);
  console.log(
    `Wrote ${relative(reportRoot, manifestPath)} with ${manifest.outputs.length} immutable outputs`,
  );
} else {
  const expected = await Bun.file(manifestPath).text();
  if (serialized !== expected) {
    const actualLines = serialized.split("\n");
    const expectedLines = expected.split("\n");
    const difference = actualLines.findIndex(
      (line, index) => line !== expectedLines[index],
    );
    throw new Error(
      `Report visual contract changed at manifest line ${(difference + 1).toString()}. Expected ${JSON.stringify(expectedLines[difference])}, received ${JSON.stringify(actualLines[difference])}. Baseline updates are forbidden during the design-system migration.`,
    );
  }
  console.log(
    `Verified ${manifest.outputs.length} report outputs and ${manifest.assets.length} font/rank assets byte-for-byte`,
  );
}
