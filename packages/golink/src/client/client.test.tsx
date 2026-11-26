import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { createThemeStore } from "@shepherdjerred/console-ui";
import type { LinkItem } from "#shared/contract.ts";
import { DeleteConfirmDialog } from "./link-dialogs.tsx";
import { LinksCard, summaryItems } from "./links-card.tsx";
import { LinksTable } from "./links-table.tsx";
import { GolinkSidebar } from "./shell.tsx";

const noop = (): void => undefined;

const LINKS: readonly LinkItem[] = [
  {
    short: "docs",
    targetUrl: "https://docs.example.com/guide",
    kind: "manual",
    clicks: 12,
    lastClickedAt: null,
  },
  {
    short: "grafana",
    targetUrl: "https://grafana.example.com/d/home",
    kind: "manual",
    shadows: {
      kind: "ingress",
      targetUrl: "https://grafana.tailnet.example/",
    },
  },
  {
    short: "argocd",
    targetUrl: "https://argocd.tailnet.example/",
    kind: "ingress",
    detail: "Tailscale cluster ingress",
  },
  {
    short: "wiki",
    targetUrl: "https://wiki.example.com/",
    kind: "site",
  },
];

function renderTable(
  writesEnabled: boolean,
  items = LINKS,
  totalCount = items.length,
): string {
  return renderToStaticMarkup(
    <LinksTable
      items={items}
      totalCount={totalCount}
      writesEnabled={writesEnabled}
      copiedShort={null}
      deletingShort={null}
      onCopy={noop}
      onEdit={noop}
      onOverride={noop}
      onDelete={noop}
    />,
  );
}

describe("LinksTable", () => {
  test("renders one body row per link with its source label", () => {
    const html = renderTable(true);
    const body = html.slice(html.indexOf("<tbody>"));
    expect(body.match(/<tr>/gu)).toHaveLength(LINKS.length);
    expect(body).toContain("go/docs");
    expect(body).toContain(">Manual<");
    expect(body).toContain(">Tailnet Ingress<");
    expect(body).toContain(">Platform Site<");
  });

  test("names the shadowed destination and truncates with a title", () => {
    const html = renderTable(true);
    expect(html).toContain("Overrides Tailnet Ingress:");
    expect(html).toContain('title="https://docs.example.com/guide"');
  });

  test("labels the copy button for assistive technology", () => {
    expect(renderTable(true)).toContain('aria-label="Copy go/docs URL"');
  });

  test("offers Edit and Delete on manual links, Override on dynamic ones", () => {
    const html = renderTable(true);
    expect(html).toContain('aria-label="Edit go/docs"');
    expect(html).toContain('aria-label="Delete go/docs"');
    expect(html).toContain('aria-label="Override go/argocd"');
    expect(html).not.toContain('aria-label="Delete go/argocd"');
  });

  test("shows no actions in read-only mode", () => {
    const html = renderTable(false);
    expect(html).not.toContain(">Edit<");
    expect(html).not.toContain(">Delete<");
    expect(html).not.toContain(">Override<");
    expect(html).toContain("Read-only");
  });

  test("renders an empty state for a filter and for an empty directory", () => {
    expect(renderTable(true, [], LINKS.length)).toBe(
      '<p class="ui-state">No shortlinks match the current filter.</p>',
    );
    expect(renderTable(true, [], 0)).toContain("No shortlinks yet.");
  });

  test("is a Hub data table whose cells carry their phone-card labels", () => {
    const html = renderTable(true);
    expect(html).toMatch(
      /^<div class="ui-data-scroll"><table class="ui-data golink-links">/u,
    );
    for (const label of ["Shortlink", "Destination", "Source", "Clicks"]) {
      expect(html).toContain(`data-label="${label}"`);
    }
  });

  test("shows the source as a tag titled with its detail", () => {
    expect(renderTable(true)).toMatch(
      /<span class="ui-tag" title="Tailscale cluster ingress"><svg[^>]*>(?:(?!<\/span>)[\s\S])*Tailnet Ingress<\/span>/u,
    );
  });
});

const COUNTS = { all: 67, manual: 4, ingress: 36, site: 25, alias: 2 };

describe("GolinkSidebar", () => {
  const theme = createThemeStore("golink-theme", {
    storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
    darkQuery: { matches: false, addEventListener: noop },
    root: { dataset: {} },
    onStorage: noop,
  });
  const html = renderToStaticMarkup(
    <GolinkSidebar
      linkCount={67}
      shortcutCount={7}
      theme={theme}
      onSearch={noop}
    />,
  );

  test("links to the page's sections with their counts", () => {
    expect(html).toContain(
      '<a href="#links" class="ui-nav-item" aria-current="page">',
    );
    expect(html).toMatch(
      /<span class="ui-nav-text">Links<\/span><span class="ui-nav-count">67<\/span>/u,
    );
    expect(html).toMatch(
      /<span class="ui-nav-text">Shortcuts<\/span><span class="ui-nav-count">7<\/span>/u,
    );
  });

  test("offers search with its keyboard shortcut", () => {
    expect(html).toMatch(
      /aria-keyshortcuts="\/"[^>]*aria-label="Search links"|aria-label="Search links"[^>]*aria-keyshortcuts="\/"/u,
    );
  });

  test("shows Go links as the current app and a theme row", () => {
    expect(html).toContain("Go links");
    expect(html).toContain('aria-label="Theme: system"');
  });
});

describe("LinksCard", () => {
  const html = renderToStaticMarkup(
    <LinksCard
      searchInputRef={{ current: null }}
      query=""
      kindFilter="ingress"
      counts={COUNTS}
      onQueryChange={noop}
      onKindFilterChange={noop}
      loadError={null}
      isInitialLoading={false}
      items={LINKS}
      totalCount={LINKS.length}
      writesEnabled
      copiedShort={null}
      deletingShort={null}
      onRetry={noop}
      onCopy={noop}
      onEdit={noop}
      onOverride={noop}
      onDelete={noop}
    />,
  );

  test("is a named card with a search field and a source filter", () => {
    expect(html).toMatch(
      /^<section class="ui-card" aria-label="Links" id="links"><div class="ui-card-toolbar"><label class="ui-search">/u,
    );
    expect(html).toContain('role="radiogroup" aria-label="Source"');
  });

  test("every source is an option with its count; only the selected one is checked", () => {
    for (const [label, count] of [
      ["All", "67"],
      ["Manual", "4"],
      ["Tailnet", "36"],
      ["Public sites", "25"],
      ["Auto-aliases", "2"],
    ] as const) {
      expect(html).toMatch(
        new RegExp(
          `${label}<span class="ui-segmented-count">${count}</span>`,
          "u",
        ),
      );
    }
    expect(html.match(/aria-checked="true"/gu)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"[^>]*>Tailnet</u);
  });

  test("shows a load error with a retry button in place of the table", () => {
    const failed = renderToStaticMarkup(
      <LinksCard
        searchInputRef={{ current: null }}
        query=""
        kindFilter="all"
        counts={COUNTS}
        onQueryChange={noop}
        onKindFilterChange={noop}
        loadError="Unable to load shortlink directory."
        isInitialLoading={false}
        items={[]}
        totalCount={0}
        writesEnabled
        copiedShort={null}
        deletingShort={null}
        onRetry={noop}
        onCopy={noop}
        onEdit={noop}
        onOverride={noop}
        onDelete={noop}
      />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Unable to load shortlink directory.");
    expect(failed).toContain(">Retry</button>");
    expect(failed).not.toContain("<table");
  });
});

describe("summaryItems", () => {
  test("counts links by source and sums clicks", () => {
    expect(summaryItems(COUNTS, LINKS, true)).toEqual([
      { label: "Links", value: "67" },
      { label: "Manual", value: "4" },
      { label: "Tailnet", value: "36" },
      { label: "Public sites", value: "25" },
      { label: "Clicks", value: "12" },
    ]);
  });

  test("shows dashes until the directory loads", () => {
    expect(
      summaryItems(COUNTS, [], false).every((item) => item.value === "—"),
    ).toBe(true);
  });
});

describe("DeleteConfirmDialog", () => {
  test("asks to confirm with the slug and destination", () => {
    const html = renderToStaticMarkup(
      <DeleteConfirmDialog
        dialogRef={{ current: null }}
        item={LINKS[0] ?? null}
        isDeleting={false}
        onConfirm={noop}
        onClose={noop}
      />,
    );
    expect(html).toMatch(/^<dialog /u);
    expect(html).toContain("Delete go/docs?");
    expect(html).toContain("It currently points to");
    expect(html).toContain("https://docs.example.com/guide");
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Delete<");
    expect(html).toContain('aria-labelledby="delete-dialog-title"');
  });
});
