export const scoutMarkViewBox = "0 0 32 32";

export const scoutMarkPaths = {
  hexagon: "M16 1.75 28.25 8.8v14.4L16 30.25 3.75 23.2V8.8L16 1.75Z",
  star: "m16 5.25 2.45 7.8L26.25 16l-7.8 2.95L16 26.75l-2.45-7.8L5.75 16l7.8-2.95L16 5.25Z",
} as const;

export const scoutMarkCircles = {
  ring: { cx: 16, cy: 16, r: 3.25 },
  pupil: { cx: 16, cy: 16, r: 1.15 },
} as const;

export const scoutMarkStroke = {
  ui: 1.5,
  favicon: 2,
} as const;

export function scoutMarkInner(options: {
  stroke: string;
  fill: string;
  strokeWidth: number;
}): string {
  return `<path d="${scoutMarkPaths.hexagon}" fill="none" stroke="${options.stroke}" stroke-width="${String(options.strokeWidth)}"/>
  <path d="${scoutMarkPaths.star}" fill="none" stroke="${options.stroke}" stroke-width="${String(options.strokeWidth)}" stroke-linejoin="round"/>
  <circle cx="${String(scoutMarkCircles.ring.cx)}" cy="${String(scoutMarkCircles.ring.cy)}" r="${String(scoutMarkCircles.ring.r)}" fill="none" stroke="${options.stroke}" stroke-width="${String(options.strokeWidth)}"/>
  <circle cx="${String(scoutMarkCircles.pupil.cx)}" cy="${String(scoutMarkCircles.pupil.cy)}" r="${String(scoutMarkCircles.pupil.r)}" fill="${options.fill}"/>`;
}

export function scoutMarkSvg(options: {
  stroke: string;
  fill: string;
  strokeWidth: number;
  ariaLabel?: string;
}): string {
  const label =
    options.ariaLabel === undefined
      ? ""
      : ` role="img" aria-label="${options.ariaLabel}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${scoutMarkViewBox}" fill="none"${label}>
  ${scoutMarkInner(options)}
</svg>
`;
}

export function scoutTileSvg(options: {
  size: number;
  radius: number;
  canvas: string;
  stroke: string;
  fill: string;
  strokeWidth: number;
  ariaLabel?: string;
}): string {
  const pad = options.size * 0.1;
  const scale = (options.size - pad * 2) / 32;
  const label =
    options.ariaLabel === undefined
      ? ""
      : ` role="img" aria-label="${options.ariaLabel}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(options.size)} ${String(options.size)}"${label}>
  <rect width="${String(options.size)}" height="${String(options.size)}" rx="${String(options.radius)}" fill="${options.canvas}"/>
  <g transform="translate(${String(pad)} ${String(pad)}) scale(${String(scale)})" fill="none">
    ${scoutMarkInner(options)}
  </g>
</svg>
`;
}
