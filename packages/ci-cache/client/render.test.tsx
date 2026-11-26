import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { createThemeStore } from "@shepherdjerred/console-ui";
import { App } from "./app.tsx";
import {
  DEMO_SUMMARY,
  computeNamespaceGroupCounts,
  filterEntries,
  filterNamespaces,
  formatBytes,
  storageWatermarkSeverity,
} from "./fixture.ts";
import { MobileBar, NamespacesSidebar, SWITCHER_APPS } from "./shell.tsx";

const noop = (): void => {
  // Static render does not dispatch DOM events.
};

const theme = createThemeStore("ci-cache-theme", {
  storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
  darkQuery: { matches: false, addEventListener: noop },
  root: { dataset: {} },
  onStorage: noop,
});

test("renders full CI cache console shell, headline figures, watermark meter, and tables", () => {
  const html = renderToStaticMarkup(
    <App theme={theme} initialSummary={DEMO_SUMMARY} />,
  );

  // AppSwitcher mark + title + Read-only badge
  expect(html).toContain("CI cache");
  expect(
    SWITCHER_APPS.some(
      (app) => app.url === "https://ci-cache.tailnet-1a49.ts.net",
    ),
  ).toBe(false);
  expect(
    SWITCHER_APPS.some(
      (app) => app.url === "https://charts.tailnet-1a49.ts.net",
    ),
  ).toBe(true);
  expect(html).toContain(">cc<");
  expect(html).toContain("switch app");
  expect(html).toContain("Read-only");

  // Sidebar group "Namespaces" with all 6 scopes
  expect(html).toContain(">Namespaces<");
  expect(html).toContain(">Overview<");
  expect(html).toContain(">Turbo (main)<");
  expect(html).toContain(">Turbo (PR)<");
  expect(html).toContain(">Gradle<");
  expect(html).toContain(">sccache (main)<");
  expect(html).toContain(">sccache (PR)<");

  // Headline FigureStrip + 850 GiB watermark / 1 TiB quota Meter
  expect(html).toContain("Hit rate (24h)");
  expect(html).toContain("94.6%");
  expect(html).toContain("Bytes served (24h)");
  expect(html).toContain("186.4 GiB");
  expect(html).toContain("Stored entries");
  expect(html).toContain("48,920");
  expect(html).toContain("850 GiB watermark / 1.00 TiB quota");
  expect(html).toContain('role="meter"');

  // Search field (`?q=`) + ui-table rows
  expect(html).toContain('name="q"');
  expect(html).toContain("ui-table");
  expect(html).toContain("turbo:monorepo");
  expect(html).toContain("sccache:trusted");
  expect(html).toContain("Signed");
});

test("marks selected sidebar item aria-current and renders mobile bar", () => {
  const counts = computeNamespaceGroupCounts(DEMO_SUMMARY.namespaces);
  expect(counts.overview).toBe(48_920);
  expect(counts["turbo-main"]).toBe(18_450);
  expect(counts["sccache-pr"]).toBe(4260);

  const sidebarHtml = renderToStaticMarkup(
    <NamespacesSidebar
      counts={counts}
      selected="sccache-main"
      theme={theme}
      onSelect={noop}
    />,
  );
  expect(sidebarHtml.match(/aria-current="page"/g)).toHaveLength(1);
  expect(sidebarHtml).toContain("Theme");

  const mobileHtml = renderToStaticMarkup(
    <MobileBar
      counts={counts}
      selected="gradle"
      theme={theme}
      onSelect={noop}
    />,
  );
  expect(mobileHtml).toContain("<select");
  expect(mobileHtml).toContain('<option value="gradle" selected="">');
});

test("filters namespaces and entries by scope and query and classifies watermarks", () => {
  expect(
    filterNamespaces(DEMO_SUMMARY.namespaces, "turbo-pr", "").map(
      (n) => n.namespace,
    ),
  ).toEqual(["turbo:monorepo-pull-request"]);

  expect(
    filterEntries(DEMO_SUMMARY.largestEntries, "sccache-main", "a4/9c").map(
      (e) => e.namespace,
    ),
  ).toEqual(["sccache:trusted"]);

  expect(formatBytes(850 * 1024 ** 3)).toBe("850 GiB");
  expect(formatBytes(1024 * 1024 ** 3)).toBe("1.00 TiB");

  expect(storageWatermarkSeverity(700, 780, 850)).toBe("ok");
  expect(storageWatermarkSeverity(800, 780, 850)).toBe("warning");
  expect(storageWatermarkSeverity(850, 780, 850)).toBe("error");
});
