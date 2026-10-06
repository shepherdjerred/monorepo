export function rgb(hex: string): [number, number, number] {
  if (!/^#[a-f\d]{6}$/i.test(hex)) throw new Error(`Invalid color: ${hex}`);
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}
export function mix(color: string, surface: string, amount: number): string {
  const a = rgb(color),
    b = rgb(surface);
  return (
    "#" +
    a
      .map((value, index) =>
        Math.round(value * (1 - amount) + (b[index] ?? 0) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  if (r === undefined || g === undefined || b === undefined)
    throw new Error("Invalid RGB channels");
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
export function contrast(a: string, b: string): number {
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export function readable(
  color: string,
  background: string,
  minimum = 4.5,
): string {
  if (contrast(color, background) >= minimum) return color;
  const target =
    contrast("#ffffff", background) > contrast("#000000", background)
      ? "#ffffff"
      : "#000000";
  for (let step = 1; step <= 100; step++) {
    const candidate = mix(color, target, step / 100);
    if (contrast(candidate, background) >= minimum) return candidate;
  }
  throw new Error(`Cannot make ${color} readable on ${background}`);
}
