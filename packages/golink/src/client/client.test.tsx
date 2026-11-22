import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { createThemeStore } from "@shepherdjerred/console-ui";
import type { LinkItem } from "#shared/contract.ts";
import { DeleteConfirmDialog } from "./link-dialogs.tsx";
import { LinksTable } from "./links-table.tsx";
import { SourcesSidebar } from "./shell.tsx";

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

function renderTable(writesEnabled: boolean, items = LINKS): string {
  return renderToStaticMarkup(
    <LinksTable
      items={items}
      totalCount={items.length}
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

  test("renders an empty state", () => {
    expect(renderTable(true, [])).toContain(
      "No shortlinks match the current filter.",
    );
  });
});

describe("SourcesSidebar", () => {
  const theme = createThemeStore("golink-theme", {
    storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
    darkQuery: { matches: false, addEventListener: noop },
    root: { dataset: {} },
    onStorage: noop,
  });
  const html = renderToStaticMarkup(
    <SourcesSidebar
      counts={{ all: 67, manual: 4, ingress: 36, site: 25, alias: 2 }}
      shortcutCount={7}
      kindFilter="ingress"
      theme={theme}
      onKindFilterChange={noop}
    />,
  );

  test("lists every source with its count", () => {
    for (const [label, count] of [
      ["All", "67"],
      ["Manual", "4"],
      ["Tailnet", "36"],
      ["Public sites", "25"],
      ["Auto-aliases", "2"],
    ] as const) {
      expect(html).toMatch(
        new RegExp(
          `<span class="ui-nav-text">${label}</span><span class="ui-nav-count">${count}</span>`,
          "u",
        ),
      );
    }
  });

  test("marks only the selected source as current", () => {
    expect(html.match(/aria-current="page"/gu)).toHaveLength(1);
    expect(html).toMatch(
      /aria-current="page"[^>]*>(?:(?!<\/button>)[\s\S])*Tailnet/u,
    );
  });

  test("shows Go links as the current app and a theme row", () => {
    expect(html).toContain("Go links");
    expect(html).toContain('aria-label="Theme: system"');
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
