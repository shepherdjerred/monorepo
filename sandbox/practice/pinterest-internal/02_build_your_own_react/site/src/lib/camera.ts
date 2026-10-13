import { clamp } from "#lib/lines.ts";

/** Keep the focus visible without leaving blank space beyond the example's ends. */
export function frameCode({
  lineCount,
  focus,
  height,
  lineHeight,
}: {
  lineCount: number;
  focus: readonly number[];
  height: number;
  lineHeight: number;
}): { height: number; y: number; scrollTop: number } {
  const low = focus.length > 0 ? Math.min(...focus) : 0;
  const high = focus.length > 0 ? Math.max(...focus) : lineCount - 1;
  const focusHeight = (high - low + 1) * lineHeight;
  const surfaceHeight = Math.max(height, lineCount * lineHeight + 32);
  const centeredY = Math.max(16, (height - focusHeight) / 2) - low * lineHeight;
  const scrollTop = clamp(16 - centeredY, 0, surfaceHeight - height);
  return { height: surfaceHeight, y: 16 - scrollTop, scrollTop };
}
