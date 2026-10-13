/** Only numeric values derived from the key enter the SVG markup. */
export function avatarSvg(key: string): string {
  let hash = 2_166_136_261;
  for (const char of key)
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16_777_619) >>> 0;
  const hue = hash % 360;
  const tiles = Array.from({ length: 15 }, (_, index) => {
    if (((hash >>> index) & 1) === 0) return "";
    const x = index % 3;
    const y = Math.floor(index / 3);
    return (
      `<rect x="${String(6 + x * 8)}" y="${String(6 + y * 8)}" width="8" height="8"/>` +
      (x < 2
        ? `<rect x="${String(6 + (4 - x) * 8)}" y="${String(6 + y * 8)}" width="8" height="8"/>`
        : "")
    );
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52"><rect width="52" height="52" rx="12" fill="hsl(${String(hue)} 45% 90%)"/><g fill="hsl(${String(hue)} 55% 40%)">${tiles}</g></svg>`;
}
