import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { computeSparklineGeometry, Sparkline } from "./sparkline.tsx";

describe("Sparkline", () => {
  it("handles empty, single-point, and flat arrays without NaN", () => {
    const emptyHtml = renderToStaticMarkup(<Sparkline values={[]} />);
    expect(emptyHtml).toContain('aria-hidden="true"');
    expect(emptyHtml).toContain('width="96"');
    expect(emptyHtml).toContain('height="24"');
    expect(emptyHtml).not.toContain("NaN");
    expect(emptyHtml).not.toContain("<polyline");

    const singleHtml = renderToStaticMarkup(<Sparkline values={[42]} />);
    expect(singleHtml).not.toContain("NaN");
    expect(singleHtml).toContain("<polyline");
    expect(singleHtml).toContain('class="visual-sparkline-dot"');

    const flatGeom = computeSparklineGeometry([7, 7, 7, 7], 96, 24);
    expect(flatGeom.points).toHaveLength(4);
    for (const pt of flatGeom.points) {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(pt.y).toBe(12);
    }
    const flatHtml = renderToStaticMarkup(
      <Sparkline values={[7, 7, 7, 7]} tone="good" />,
    );
    expect(flatHtml).not.toContain("NaN");
    expect(flatHtml).toContain('data-sev="ok"');
  });

  it("renders polyline, area gradient, and final-point dot for multi-point series", () => {
    const html = renderToStaticMarkup(
      <Sparkline
        values={[10, Number.NaN, 25, 15, 40]}
        width={120}
        height={28}
        tone="warning"
      />,
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain('class="visual-sparkline" data-sev="warning"');
    expect(html).toContain('viewBox="0 0 120 28"');
    expect(html).toContain("<linearGradient");
    expect(html).toContain("<path");
    expect(html).toContain("<polyline");
    expect(html).toContain('class="visual-sparkline-dot"');
  });
});
