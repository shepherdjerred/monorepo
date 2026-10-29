import type { Annotation } from "./media.ts";

export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Pure geometry shared by the browser and offline renderer. */
export function overlaySvg(
  cues: readonly Annotation[],
  width: number,
  height: number,
): string {
  const elements = cues
    .map((cue) => {
      const [x, y] = [cue.from[0] * width, cue.from[1] * height];
      const [tx, ty] = [cue.to[0] * width, cue.to[1] * height];
      const shape =
        cue.kind === "arrow"
          ? `<path d="M${x.toString()} ${y.toString()}L${tx.toString()} ${ty.toString()}" marker-end="url(#tip)"/>`
          : cue.kind === "box"
            ? `<rect x="${Math.min(x, tx).toString()}" y="${Math.min(y, ty).toString()}" width="${Math.abs(tx - x).toString()}" height="${Math.abs(ty - y).toString()}" rx="4"/>`
            : "";
      return `<g fill="none" stroke="#ffda69" stroke-width="4">${shape}</g><text x="${x.toString()}" y="${Math.max(28, y - 12).toString()}" font-family="sans-serif" font-size="24" font-weight="bold" fill="white" stroke="#151b27" stroke-width="5" paint-order="stroke">${escapeXml(cue.text)}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toString()}" height="${height.toString()}" viewBox="0 0 ${width.toString()} ${height.toString()}"><defs><marker id="tip" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0 0L7 3L0 6" fill="none" stroke="#ffda69" stroke-width="1.5"/></marker></defs>${elements}</svg>`;
}
