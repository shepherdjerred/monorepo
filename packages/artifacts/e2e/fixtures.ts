/**
 * Deterministic fixture artifacts, generated into a directory at run time:
 * HTML (two versions, plus a multi-file site), a PNG, a three-page PDF,
 * Markdown, an asciicast, a Mermaid source and an opaque binary. The MP4 and
 * WebM clips are the one exception: they are checked in under `e2e/media`
 * (a two-second 320x240 test pattern, about 59 KB) because the Playwright CI
 * image has no ffmpeg to encode them.
 */
import { deflateSync } from "node:zlib";
import path from "node:path";
import { copyFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ArtifactKind, Viewport } from "#shared/contract.ts";

const CLIPS = {
  mp4: path.join(import.meta.dir, "media/clip.mp4"),
  webm: path.join(import.meta.dir, "media/clip.webm"),
} as const;

export type FixtureFile = {
  /** The path inside the artifact. */
  readonly path: string;
  readonly mediaType: string;
  /** The generated file on disk. */
  readonly absPath: string;
};

export type Fixture = {
  readonly title: string;
  readonly kind: ArtifactKind;
  readonly entryPath: string;
  readonly files: readonly FixtureFile[];
  readonly viewport?: Viewport;
};

export const FIXTURE_NAMES = [
  "htmlV1",
  "htmlV2",
  "site",
  "png",
  "pdf",
  "mp4",
  "webm",
  "markdown",
  "cast",
  "mermaid",
  "bin",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];
export type Fixtures = Record<FixtureName, Fixture> & { readonly dir: string };

const MEDIA_TYPES: Record<string, string> = {
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  png: "image/png",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  md: "text/markdown",
  cast: "text/plain",
  mmd: "text/plain",
  bin: "application/octet-stream",
};

export function mediaTypeOf(file: string): string {
  return (
    MEDIA_TYPES[path.extname(file).slice(1).toLowerCase()] ??
    "application/octet-stream"
  );
}

// ── Binary generators ───────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = (value & 1) === 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes)
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** A width x height RGB gradient with a diagonal stripe, as a valid PNG. */
export function pngBytes(width: number, height: number): Uint8Array {
  const rows = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const stripe = Math.abs(x - y) < 6;
      const at = row + 1 + x * 3;
      rows[at] = stripe ? 255 : Math.round((x / width) * 255);
      rows[at + 1] = stripe ? 255 : Math.round((y / height) * 255);
      rows[at + 2] = stripe ? 255 : 160;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

function pdfEscape(text: string): string {
  return text.replaceAll(/[\\()]/gu, String.raw`\$&`);
}

/** The object number of page `index`; its content stream follows it. */
function pageObject(index: number): number {
  return 4 + index * 2;
}

/** A minimal valid PDF 1.4 with one Helvetica page per entry (one line of text each). */
export function pdfBytes(
  pages: readonly (readonly [string, string])[],
): Uint8Array {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Count ${String(pages.length)} /Kids [${pages.map((_, index) => `${String(pageObject(index))} 0 R`).join(" ")}] >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const [index, [heading, line]] of pages.entries()) {
    const stream = `BT /F1 30 Tf 72 700 Td (${pdfEscape(heading)}) Tj ET\nBT /F1 14 Tf 72 660 Td (${pdfEscape(line)}) Tj ET\n72 600 468 2 re f\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(pageObject(index) + 1)} 0 R >>`,
      `<< /Length ${String(stream.length)} >>\nstream\n${stream}endstream`,
    );
  }
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(out.length);
    out += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

// ── Text generators ─────────────────────────────────────────────────────────

const htmlPage = (title: string, body: string, head = ""): string =>
  `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${title}</title>${head}</head>\n<body>\n${body}\n</body>\n</html>\n`;

const HTML_V1 = htmlPage(
  "Concept A v1",
  `<main style="font-family:sans-serif;padding:32px"><h1>Concept A v1</h1><p>The first draft of concept A.</p></main>`,
);

/** About 3000 px tall (six 500 px sections) and free of links. */
const HTML_V2 = htmlPage(
  "Concept A v2",
  [
    `<style>html,body{margin:0;font-family:sans-serif}section{height:500px;box-sizing:border-box;padding:32px;color:#fff}</style>`,
    ...["#264653", "#2a9d8f", "#8a6d1f", "#b4572f", "#a23e48", "#4a3f7a"].map(
      (color, index) =>
        `<section style="background:${color}"><h1>${index === 0 ? "Concept A v2" : `Section ${String(index + 1)}`}</h1><p>The second draft keeps scrolling. Section ${String(index + 1)} of 6.</p></section>`,
    ),
  ].join("\n"),
);

const SITE_INDEX = htmlPage(
  "Site fixture",
  `<main><h1 id="title">Site fixture</h1><p id="status">Waiting for app.js</p><p><a href="about.html">About this site</a></p></main>\n<script src="app.js"></script>`,
  `<link rel="stylesheet" href="app.css">`,
);
const SITE_ABOUT = htmlPage(
  "About",
  `<main><h1>About</h1><p><a href="index.html">Back to the site</a></p></main>\n<script src="app.js"></script>`,
  `<link rel="stylesheet" href="app.css">`,
);
const SITE_CSS =
  "body{font-family:sans-serif;margin:0;padding:24px;background:#f4f1de}h1{color:#3d405b}\n";
const SITE_JS = `const status = document.getElementById("status");\nif (status) status.textContent = "app.js loaded";\ndocument.documentElement.dataset.siteLoaded = "true";\n`;

const MARKDOWN = `# Fixture Markdown

An introduction with **bold**, _italic_ and a [documentation link](https://example.com/docs).

## A table

| Name  | Kind     | Size |
| ----- | -------- | ---- |
| alpha | html     | 1 KB |
| bravo | markdown | 2 KB |

## Images

![Local picture](./pic.png)

![Remote picture](https://example.com/remote.png)

## Raw HTML

<script>window.__markdownScriptRan = true</script>

The end.
`;

const CAST = [
  {
    version: 2,
    width: 80,
    height: 24,
    timestamp: 1_700_000_000,
    title: "Fixture cast",
  },
  [0.2, "o", "$ echo hello\r\n"],
  [0.6, "o", "hello\r\n"],
  [1, "o", "$ ls\r\n"],
  [1.4, "o", "alpha  bravo  charlie\r\n"],
]
  .map((line) => JSON.stringify(line))
  .join("\n")
  .concat("\n");

const MERMAID =
  "graph TD\n  A[Start] --> B{Review}\n  B -->|approve| C[Ship]\n  B -->|changes| A\n";

const BIN = Uint8Array.from(
  { length: 256 },
  (_, index) => (index * 7 + 3) % 256,
);

// ── Generation ──────────────────────────────────────────────────────────────

async function put(
  dir: string,
  relative: string,
  data: string | Uint8Array,
): Promise<FixtureFile> {
  const absPath = path.join(dir, relative);
  await Bun.write(absPath, data);
  return { path: relative, mediaType: mediaTypeOf(relative), absPath };
}

/** Writes every fixture under `dir` (a fresh temp directory by default). */
export async function generateFixtures(dir?: string): Promise<Fixtures> {
  const root =
    dir ?? (await mkdtemp(path.join(tmpdir(), "artifacts-fixtures-")));
  const at = (name: string): string => path.join(root, name);
  const desktop = { width: 1440, height: 900 };
  const [htmlV1, htmlV2, siteIndex, siteAbout, siteCss, siteJs] =
    await Promise.all([
      put(at("htmlV1"), "index.html", HTML_V1),
      put(at("htmlV2"), "index.html", HTML_V2),
      put(at("site"), "index.html", SITE_INDEX),
      put(at("site"), "about.html", SITE_ABOUT),
      put(at("site"), "app.css", SITE_CSS),
      put(at("site"), "app.js", SITE_JS),
    ]);
  const png = await put(at("png"), "picture.png", pngBytes(240, 160));
  const pdf = await put(
    at("pdf"),
    "report.pdf",
    pdfBytes([
      ["Page one", "Alpha: the quick brown fox"],
      ["Page two", "Bravo: jumps over the lazy dog"],
      ["Page three", "Charlie: and runs away"],
    ]),
  );
  await mkdir(at("video"), { recursive: true });
  await Promise.all([
    copyFile(CLIPS.mp4, at("video/clip.mp4")),
    copyFile(CLIPS.webm, at("video/clip.webm")),
  ]);
  const mp4: FixtureFile = {
    path: "clip.mp4",
    mediaType: "video/mp4",
    absPath: at("video/clip.mp4"),
  };
  const webm: FixtureFile = {
    path: "clip.webm",
    mediaType: "video/webm",
    absPath: at("video/clip.webm"),
  };
  const markdown = await put(at("markdown"), "README.md", MARKDOWN);
  const markdownPicture = await put(
    at("markdown"),
    "pic.png",
    pngBytes(120, 80),
  );
  const cast = await put(at("cast"), "demo.cast", CAST);
  const mermaid = await put(at("mermaid"), "flow.mmd", MERMAID);
  const bin = await put(at("bin"), "data.bin", BIN);
  return {
    dir: root,
    htmlV1: {
      title: "Concept A v1",
      kind: "html",
      entryPath: "index.html",
      files: [htmlV1],
      viewport: desktop,
    },
    htmlV2: {
      title: "Concept A v2",
      kind: "html",
      entryPath: "index.html",
      files: [htmlV2],
      viewport: desktop,
    },
    site: {
      title: "Site fixture",
      kind: "site",
      entryPath: "index.html",
      files: [siteIndex, siteAbout, siteCss, siteJs],
      viewport: desktop,
    },
    png: {
      title: "Gradient",
      kind: "image",
      entryPath: "picture.png",
      files: [png],
    },
    pdf: {
      title: "Three page report",
      kind: "pdf",
      entryPath: "report.pdf",
      files: [pdf],
    },
    mp4: {
      title: "Test clip (mp4)",
      kind: "video",
      entryPath: "clip.mp4",
      files: [mp4],
    },
    webm: {
      title: "Test clip (webm)",
      kind: "video",
      entryPath: "clip.webm",
      files: [webm],
    },
    markdown: {
      title: "Notes",
      kind: "markdown",
      entryPath: "README.md",
      files: [markdown, markdownPicture],
    },
    cast: {
      title: "Terminal session",
      kind: "cast",
      entryPath: "demo.cast",
      files: [cast],
    },
    mermaid: {
      title: "Flow",
      kind: "mermaid",
      entryPath: "flow.mmd",
      files: [mermaid],
    },
    bin: {
      title: "Opaque data",
      kind: "file",
      entryPath: "data.bin",
      files: [bin],
    },
  };
}
