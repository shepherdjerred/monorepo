import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BudgetMeter, StackedMeter } from "./meters.tsx";

describe("BudgetMeter", () => {
  it("renders an accessible meter with projection marker and detail", () => {
    const html = renderToStaticMarkup(
      <BudgetMeter
        label="Monthly API spend"
        value={86.4}
        max={150}
        unit="usd"
        severity="warning"
        projectedValue={162}
        detail="Projected above monthly cap"
      />,
    );
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="Monthly API spend"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="150"');
    expect(html).toContain('aria-valuenow="86.4"');
    expect(html).toContain(
      'aria-valuetext="$86.40 of $150.00 (projected $162.00)"',
    );
    expect(html).toContain('class="visual-meter-projection"');
    expect(html).toContain("left:100%");
    expect(html).toContain('<span class="ui-glyph-label">Warning</span>');
    expect(html).toContain("Projected above monthly cap");
  });

  it("handles null readings cleanly without NaN or projection tick", () => {
    const html = renderToStaticMarkup(
      <BudgetMeter label="Memory used" value={null} max={100} unit="percent" />,
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('aria-valuetext="No data"');
    expect(html).not.toContain("visual-meter-projection");
  });
});

describe("StackedMeter", () => {
  it("renders proportional horizontal segments and a tabular swatch legend", () => {
    const html = renderToStaticMarkup(
      <StackedMeter
        label="Cluster pods by phase"
        segments={[
          { key: "running", label: "Running", value: 75, color: "#0ca30c" },
          { key: "pending", label: "Pending", value: 15, color: "#fab219" },
          { key: "failed", label: "Failed", value: 10, color: "#d03b3b" },
        ]}
      />,
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain("width:75%");
    expect(html).toContain("width:15%");
    expect(html).toContain("width:10%");
    expect(html).toContain('class="visual-swatch"');
    expect(html).toContain("Running");
    expect(html).toContain("(75%)");
    expect(html).toContain("(15%)");
    expect(html).toContain("(10%)");
  });

  it("handles zero-total segments safely without dividing by zero", () => {
    const html = renderToStaticMarkup(
      <StackedMeter
        label="Queue items"
        segments={[
          { key: "queued", label: "Queued", value: 0 },
          { key: "failed", label: "Failed", value: 0 },
        ]}
      />,
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain("(0%)");
    expect(html).not.toContain("visual-stacked-segment");
  });
});
