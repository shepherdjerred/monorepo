import { defined } from "#lib/invariant.ts";
import type { Hover, Line } from "#lib/lines.ts";

function boundaries(
  from: number,
  to: number,
  hovers: Hover[],
  columns?: [number, number],
): number[] {
  const cuts = new Set([from, to]);
  const candidates = hovers.flatMap((hover) => [hover.start, hover.end]);
  if (columns !== undefined) candidates.push(columns[0] - 1, columns[1]);
  for (const candidate of candidates)
    if (candidate > from && candidate < to) cuts.add(candidate);
  return [...cuts].sort((a, b) => a - b);
}

export function fillLine(
  node: HTMLElement,
  line: Line,
  options: {
    hovers: Hover[];
    infos: string[];
    columns: [number, number] | undefined;
  },
): void {
  const { hovers, infos, columns } = options;
  const signature = JSON.stringify([hovers, columns]);
  if (node.dataset.signature === signature) return;
  node.dataset.signature = signature;
  const fragment = document.createDocumentFragment();
  for (const token of line.tokens) {
    const from = token.start,
      to = from + token.text.length;
    const points = boundaries(from, to, hovers, columns);
    for (let i = 1; i < points.length; i++) {
      const start = defined(points[i - 1]),
        end = defined(points[i]);
      const span = document.createElement("span");
      span.textContent = token.text.slice(start - from, end - from);
      span.style.color = token.color;
      span.dataset.column = String(start + 1);
      const info = hovers.find(
        (item) => item.start <= start && item.end >= end,
      );
      if (info !== undefined) {
        span.dataset.type = defined(infos[info.info]);
        span.tabIndex = 0;
        span.className = "type-token";
      }
      fragment.append(span);
    }
  }
  if (fragment.childNodes.length === 0)
    fragment.append(document.createTextNode(" "));
  node.replaceChildren(fragment);
}
