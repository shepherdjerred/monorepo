import path from "node:path";
import { mkdir, readdir, cp, chmod, lstat, rm } from "node:fs/promises";
import sharp from "sharp";
import { escapeXml, overlaySvg } from "#protocol/media-overlay.ts";
import type { Annotation } from "#protocol/media.ts";
import { command } from "#src/capture/suite/process.ts";
import {
  publicFile,
  probeVideo,
  type auditCatalog,
  type CatalogEntry,
} from "./audit.ts";

export function sampleFrames(frames: number, cues: Annotation[]) {
  if (!Number.isInteger(frames) || frames < 1)
    throw new Error("Invalid clip frame count");
  return [
    ...new Set([
      0,
      Math.floor((frames - 1) / 2),
      frames - 1,
      ...cues.map((cue) =>
        Math.min(
          frames - 1,
          Math.floor(((cue.startMs + cue.endMs) / 2000) * 30),
        ),
      ),
    ]),
  ].sort((a, b) => a - b);
}

type Card = {
  scenario: string;
  shot: string;
  frame: number;
  timestamp: number;
  file: string;
};
async function reviewEntry(
  entry: CatalogEntry,
  publicRoot: string,
  output: string,
  cards: Card[],
) {
  const m = entry.media,
    destination = path.join(output, "media", m.name);
  await mkdir(destination, { recursive: true });
  for (const file of entry.files)
    await cp(
      await publicFile(publicRoot, `media/${m.name}/${file}`),
      path.join(destination, file),
    );
  const source = path.join(
    destination,
    m.kind === "image" ? "original.webp" : "clip.mp4",
  );
  const video = m.kind === "video" ? await probeVideo(source) : undefined;
  const frames =
    video === undefined ? [0] : sampleFrames(video.frames, m.annotations);
  const pictures: string[] = [];
  const annotated = m.kind === "image" ? "annotated.webp" : "annotated.mp4";
  const original = m.kind === "image" ? "original.webp" : "clip.mp4";
  for (const frame of frames) {
    const timestamp = frame / 30;
    const file = `${m.name}-${frame.toString()}.png`;
    let input = source;
    if (m.kind === "video") {
      input = path.join(output, `${m.name}-frame.png`);
      await command([
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-ss",
        timestamp.toString(),
        "-i",
        source,
        "-frames:v",
        "1",
        input,
      ]);
    }
    const cues =
      m.kind === "image"
        ? m.annotations
        : m.annotations.filter(
            (c) => c.startMs <= timestamp * 1000 && c.endMs > timestamp * 1000,
          );
    const height = Math.round((640 * m.height) / m.width);
    await sharp(input)
      .resize(640, height)
      .composite([{ input: Buffer.from(overlaySvg(cues, 640, height, 16)) }])
      .png()
      .toFile(path.join(output, file));
    if (m.kind === "video") await rm(input);
    cards.push({
      scenario: entry.scenario,
      shot: m.name,
      frame,
      timestamp,
      file,
    });
    pictures.push(
      `<figure><a href="media/${m.name}/${annotated}"><img width="640" height="${height.toString()}" loading="lazy" src="${file}" alt="${escapeXml(m.alt)}"></a><figcaption>${previewCaption(m, timestamp)}</figcaption></figure>`,
    );
  }
  return `<article id="${m.name}"><h2>${escapeXml(entry.scenario)} / ${escapeXml(m.name)}</h2><p>${escapeXml(m.caption)}</p><p class="alt">Alt: ${escapeXml(m.alt)}</p><div class="grid">${pictures.join("")}</div><p><a href="media/${m.name}/${original}">Original</a> · <a href="media/${m.name}/${annotated}">Annotated</a></p>${videoPlayer(m)}</article>`;
}

function videoPlayer(m: CatalogEntry["media"]) {
  return m.kind === "video"
    ? `<video controls preload="none" aria-label="${escapeXml(m.alt)}" src="media/${m.name}/clip.mp4" poster="media/${m.name}/poster.webp"></video>`
    : "";
}

function previewCaption(m: CatalogEntry["media"], timestamp: number) {
  return m.kind === "image"
    ? "Annotated preview"
    : `${timestamp.toFixed(2)} seconds`;
}

/** A portable report contains only public assets and generated review images. */
export async function reviewCatalog(
  catalog: Awaited<ReturnType<typeof auditCatalog>>,
  publicRoot: string,
  output: string,
) {
  await mkdir(output, { recursive: true, mode: 0o700 });
  const entries = await readdir(output),
    stat = await lstat(output);
  if (entries.length > 0)
    throw new Error("Review output directory must be empty");
  if (stat.isSymbolicLink()) throw new Error("Linked review directory");
  await chmod(output, 0o700);
  const cards: Card[] = [],
    articles: string[] = [];
  for (const entry of catalog.entries)
    articles.push(await reviewEntry(entry, publicRoot, output, cards));
  const sheets: string[] = [];
  for (let i = 0; i < cards.length; i += 8) {
    const group = cards.slice(i, i + 8),
      tileHeight = 400;
    const layers = [];
    for (const [index, card] of group.entries()) {
      const title = Buffer.from(
        `<svg width="640" height="40"><rect width="640" height="40" fill="#20242b"/><text x="12" y="26" fill="white" font-family="sans-serif" font-size="16">${escapeXml(`${card.shot} @ ${card.timestamp.toFixed(2)}s`)}</text></svg>`,
      );
      layers.push({
        input: title,
        left: (index % 2) * 640,
        top: Math.floor(index / 2) * tileHeight,
      });
      layers.push({
        input: await sharp(path.join(output, card.file))
          .resize(640, 360, { fit: "contain" })
          .toBuffer(),
        left: (index % 2) * 640,
        top: Math.floor(index / 2) * tileHeight + 40,
      });
    }
    const file = `sheet-${(sheets.length + 1).toString()}.png`;
    await sharp({
      create: {
        width: 1280,
        height: Math.ceil(group.length / 2) * tileHeight,
        channels: 3,
        background: "#20242b",
      },
    })
      .composite(layers)
      .png()
      .toFile(path.join(output, file));
    sheets.push(file);
  }
  await Bun.write(
    path.join(output, "inventory.json"),
    JSON.stringify({ ...catalog, cards, sheets }, null, 2),
  );
  await Bun.write(
    path.join(output, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capture review</title><style>body{font:16px/1.5 system-ui;margin:auto;max-width:1400px;padding:24px;background:#141922;color:#eef1f6}a{color:#a8d4ff}a:focus-visible,video:focus-visible{outline:3px solid #ffda69;outline-offset:4px}article{border-top:1px solid #475366;padding:24px 0}h2{overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:20px}figure{margin:0}img,video{max-width:100%;height:auto}video{width:800px}figcaption,.alt{color:#bfc9d8}</style><h1>Capture review: ${escapeXml(catalog.suite)}</h1><p>${catalog.entries.length.toString()} shots · ${catalog.issues.length.toString()} audit issues. Inspect composition, annotation placement, and usefulness before committing.</p><nav aria-label="Contact sheets">${sheets.map((s) => `<a href="${s}">${s}</a>`).join(" · ")}</nav>${catalog.issues.map((i) => `<p>${escapeXml(`${i.scenario}/${i.shot}: ${i.file}: ${i.message}`)}</p>`).join("")}${articles.join("")}</html>`,
  );
  return {
    directory: output,
    index: path.join(output, "index.html"),
    shots: catalog.entries.length,
    cards: cards.length,
    sheets: sheets.length,
    issues: catalog.issues,
  };
}
