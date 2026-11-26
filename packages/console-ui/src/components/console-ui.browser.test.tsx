import { afterEach, describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import "@shepherdjerred/console-ui/styles/index.css";
import { Button } from "@shepherdjerred/console-ui/components/button.tsx";
import { FigureStrip } from "@shepherdjerred/console-ui/components/figure-strip.tsx";
import { HeaderBar } from "@shepherdjerred/console-ui/components/header-bar.tsx";
import { Tabs } from "@shepherdjerred/console-ui/components/tabs.tsx";
import {
  THEMES,
  VIEWPORTS,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  setTheme,
  setViewport,
} from "@shepherdjerred/console-ui/testing/browser.ts";

function noop(): void {
  // Display-only fixture.
}

function Fixture(): React.JSX.Element {
  return (
    <>
      <HeaderBar
        title="Alerts"
        tabs={
          <Tabs
            label="Show"
            value="open"
            onChange={noop}
            options={[
              { value: "open", label: "Open", count: 3 },
              { value: "all", label: "All" },
            ]}
          />
        }
        meta="Snapshot generated 1m ago"
        actions={<Button>Refresh</Button>}
      />
      <main>
        <FigureStrip
          figures={[
            { label: "Open", value: 3 },
            { label: "Errors", value: 1, severity: "error" },
          ]}
        />
        <div className="ui-table-scroll">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>api</td>
                <td>firing</td>
              </tr>
              <tr>
                <td>worker</td>
                <td>ok</td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function find(selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`missing element: ${selector}`);
  return element;
}

afterEach(async () => {
  delete document.documentElement.dataset["theme"];
  await setViewport();
});

describe.each(THEMES)("console-ui in the %s theme", (theme) => {
  test("has no WCAG 2.2 AA axe violations", async () => {
    setTheme(theme);
    const screen = await render(<Fixture />);
    await expect
      .element(screen.getByRole("heading", { name: "Alerts" }))
      .toBeVisible();
    await expectNoAxeViolations();
  });
});

describe("console-ui computed styles", () => {
  test("uses the console dimensions", async () => {
    await render(<Fixture />);
    expect(find(".ui-header").getBoundingClientRect().height).toBe(48);
    expect(find(".ui-btn").getBoundingClientRect().height).toBe(28);
    expect(find(".ui-table thead th").getBoundingClientRect().height).toBe(30);
    expect(find(".ui-table tbody td").getBoundingClientRect().height).toBe(36);
  });

  test("never uppercases headers", async () => {
    await render(<Fixture />);
    for (const selector of [".ui-header-title", ".ui-table thead th"]) {
      expect(getComputedStyle(find(selector)).textTransform).not.toBe(
        "uppercase",
      );
    }
  });

  test("does not overflow horizontally at 375px", async () => {
    await setViewport(VIEWPORTS.mobile);
    await render(<Fixture />);
    expectNoHorizontalOverflow();
  });
});
