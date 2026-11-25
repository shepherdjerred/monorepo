import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  createThemeStore,
  type ThemeEnvironment,
} from "@shepherdjerred/console-ui";
import { CatalogWorkspace } from "./app.tsx";
import { DEMO_CATALOG_SUMMARY, EMPTY_CATALOG_SUMMARY } from "./fixtures.ts";

const noop = (): void => {
  // Static markup rendering never fires DOM events.
};

const environment: ThemeEnvironment = {
  storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
  darkQuery: { matches: false, addEventListener: noop },
  root: { dataset: {} },
  onStorage: noop,
};

const theme = createThemeStore("charts-theme-test", environment);

describe("Charts console-ui rendering", () => {
  test("renders populated catalog with sidebar counts, figure strip, quota meter, and rows", () => {
    const html = renderToStaticMarkup(
      <CatalogWorkspace
        summary={DEMO_CATALOG_SUMMARY}
        loadError={null}
        isInitialLoading={false}
        query=""
        filter="all"
        expandedNames={new Set()}
        theme={theme}
        onQueryChange={noop}
        onFilterChange={noop}
        onToggleExpand={noop}
        onRetry={noop}
      />,
    );

    expect(html).toContain("Charts");
    expect(html).toContain("Revision 184");
    expect(html).toContain("Read-only");
    expect(html).toContain('href="/index.yaml"');
    // Sidebar Catalog group with All / First-party / Upstream mirrors
    expect(html).toContain(">Catalog<");
    expect(html).toContain(">All<");
    expect(html).toContain(">First-party<");
    expect(html).toContain(">Upstream mirrors<");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    // FigureStrip + Meter
    expect(html).toContain("2.0.0-101844");
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="Chart storage quota"');
    // Chart rows and download links
    expect(html).toContain("delivery");
    expect(html).toContain("cert-manager");
    expect(html).toContain('href="/charts/delivery-2.0.0-101844.tgz"');
    expect(html).not.toContain("ui-table-child");
  });

  test("renders expanded chart row with all retained child versions", () => {
    const html = renderToStaticMarkup(
      <CatalogWorkspace
        summary={DEMO_CATALOG_SUMMARY}
        loadError={null}
        isInitialLoading={false}
        query=""
        filter="first-party"
        expandedNames={new Set(["delivery"])}
        theme={theme}
        onQueryChange={noop}
        onFilterChange={noop}
        onToggleExpand={noop}
        onRetry={noop}
      />,
    );

    expect(html).toContain("ui-table-child");
    expect(html).toContain("2.0.0-101844");
    expect(html).toContain("2.0.0-101839");
    expect(html).toContain("2.0.0-101831");
    expect(html).toContain('href="/api/charts/delivery/2.0.0-101839"');
    expect(html).not.toContain("cert-manager");
  });

  test("renders empty catalog and zero-match search states cleanly", () => {
    const emptyHtml = renderToStaticMarkup(
      <CatalogWorkspace
        summary={EMPTY_CATALOG_SUMMARY}
        loadError={null}
        isInitialLoading={false}
        query=""
        filter="all"
        expandedNames={new Set()}
        theme={theme}
        onQueryChange={noop}
        onFilterChange={noop}
        onToggleExpand={noop}
        onRetry={noop}
      />,
    );
    expect(emptyHtml).toContain(
      "No Helm charts have been published to this repository yet.",
    );

    const noMatchHtml = renderToStaticMarkup(
      <CatalogWorkspace
        summary={DEMO_CATALOG_SUMMARY}
        loadError={null}
        isInitialLoading={false}
        query="nonexistent-chart-xyz"
        filter="all"
        expandedNames={new Set()}
        theme={theme}
        onQueryChange={noop}
        onFilterChange={noop}
        onToggleExpand={noop}
        onRetry={noop}
      />,
    );
    expect(noMatchHtml).toContain("“nonexistent-chart-xyz”");
  });
});
