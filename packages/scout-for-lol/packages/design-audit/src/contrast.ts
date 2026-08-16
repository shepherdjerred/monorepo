export function parseColor(
  value: string,
): [number, number, number, number] | null {
  const normalized = value.replaceAll(" ", "");
  const match = /^rgba?\(([^)]+)\)$/.exec(normalized);
  if (match !== null) {
    const components = match[1];
    if (components === undefined) return null;
    const values = components.split(",");
    if (values.length < 3) return null;
    const red = Number(values[0]);
    const green = Number(values[1]);
    const blue = Number(values[2]);
    const alpha = values[3] === undefined ? 1 : Number(values[3]);
    if ([red, green, blue, alpha].some((component) => Number.isNaN(component)))
      return null;
    return [red, green, blue, alpha];
  }
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(normalized);
  const digits = hex?.[1];
  if (digits === undefined) return null;
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
    hex?.[2] === undefined ? 1 : Number.parseInt(hex[2], 16) / 255,
  ];
}

function luminanceChannel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(
  color: [number, number, number, number],
): number {
  return (
    0.2126 * luminanceChannel(color[0]) +
    0.7152 * luminanceChannel(color[1]) +
    0.0722 * luminanceChannel(color[2])
  );
}

export function contrastRatio(
  foreground: [number, number, number, number],
  background: [number, number, number, number],
): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const high = Math.max(foregroundLuminance, backgroundLuminance);
  const low = Math.min(foregroundLuminance, backgroundLuminance);
  return (high + 0.05) / (low + 0.05);
}
