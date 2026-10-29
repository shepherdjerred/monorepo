import type { PublicMedia } from "./media.ts";
import { escapeXml } from "./media-overlay.ts";

export function mediaMarkup(manifest: PublicMedia): string {
  const dimensions = `width="${manifest.width.toString()}" height="${manifest.height.toString()}"`;
  const element =
    manifest.kind === "video"
      ? `<video controls muted playsinline preload="metadata" poster="${manifest.poster}" aria-label="${escapeXml(manifest.alt)}" src="${manifest.src}" ${dimensions}></video>`
      : `<img alt="${escapeXml(manifest.alt)}" src="${manifest.src}" ${dimensions} loading="lazy" decoding="async">`;
  const download = `/media/${manifest.name}/${manifest.kind === "video" ? "annotated.mp4" : "annotated.webp"}`;
  return `<storm-media data-manifest="/media/${manifest.name}/media.json"><figure>${element}<figcaption>${escapeXml(manifest.caption)}</figcaption></figure></storm-media>\n<p><a href="${download}" download>Download annotated ${manifest.kind}</a></p>`;
}
