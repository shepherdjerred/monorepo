import { renderToStaticMarkup } from "react-dom/server";
import { ClockIcon, HouseIcon } from "lucide-react";
import { describe, expect, test } from "vitest";
import { Banner } from "@shepherdjerred/console-ui/components/banner.tsx";
import { Button } from "@shepherdjerred/console-ui/components/button.tsx";
import { Chip } from "@shepherdjerred/console-ui/components/chip.tsx";
import { createCommandPaletteStore } from "@shepherdjerred/console-ui/components/command-palette.tsx";
import { ConsoleShell } from "@shepherdjerred/console-ui/components/shell/console-shell.tsx";
import { Dialog } from "@shepherdjerred/console-ui/components/dialog.tsx";
import { FigureStrip } from "@shepherdjerred/console-ui/components/figure-strip.tsx";
import { HeaderBar } from "@shepherdjerred/console-ui/components/header-bar.tsx";
import { NavTabs } from "@shepherdjerred/console-ui/components/nav-tabs.tsx";
import { Section } from "@shepherdjerred/console-ui/components/section.tsx";
import { SidebarGroup } from "@shepherdjerred/console-ui/components/shell/sidebar.tsx";
import { SidebarItem } from "@shepherdjerred/console-ui/components/shell/sidebar-item.tsx";
import { State } from "@shepherdjerred/console-ui/components/state.tsx";
import { StatusGlyph } from "@shepherdjerred/console-ui/components/status-glyph.tsx";
import { createThemeStore } from "@shepherdjerred/console-ui/theme.ts";

const noop = (): void => {
  // Static rendering never fires events.
};

describe("ConsoleShell", () => {
  const theme = createThemeStore(undefined, {
    storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
    darkQuery: { matches: false, addEventListener: noop },
    root: { dataset: {} },
    onStorage: noop,
  });
  const html = renderToStaticMarkup(
    <ConsoleShell
      app={{ label: "Hub", mark: "H" }}
      apps={[{ label: "Hub", url: "/", group: "Ops" }]}
      theme={theme}
      palette={{ store: createCommandPaletteStore(null), label: "Search" }}
      nav={() => (
        <SidebarGroup label="Ops">
          <SidebarItem href="/" label="Home" icon={HouseIcon} current />
        </SidebarGroup>
      )}
    >
      <main id="main">page</main>
    </ConsoleShell>,
  );

  test("starts with a skip link to the main content", () => {
    expect(html).toMatch(
      /^<a class="ui-skip-link" href="#main">Skip to content<\/a>/,
    );
  });

  test("draws the phone top bar with its search and theme buttons", () => {
    expect(html).toContain('<header class="ui-topbar">');
    expect(html).toContain('aria-label="Open navigation"');
    expect(html.match(/aria-label="Search"/g)).toHaveLength(2);
  });

  test("declares the navigation once, in the sidebar while the drawer is shut", () => {
    expect(html.match(/<nav /g)).toHaveLength(1);
    expect(html).toContain('<aside class="ui-side" aria-label="Hub">');
    expect(html).toContain('aria-current="page"');
  });

  test("puts the theme row in the sidebar footer and the page in the panel", () => {
    expect(html).toContain('class="ui-nav-item ui-theme-row"');
    expect(html).toContain('<div class="ui-panel"><main id="main">page</main>');
  });
});

describe("HeaderBar", () => {
  test("renders a lead before the h1 and focusable titles by id", () => {
    const html = renderToStaticMarkup(
      <HeaderBar
        lead={<a href="/alerts">Alerts</a>}
        title="KubePodCrashLooping"
        titleId="page-title"
      />,
    );
    expect(html).toBe(
      '<header class="ui-header"><div class="ui-header-lead"><a href="/alerts">Alerts</a></div><h1 class="ui-header-title" id="page-title" tabindex="-1">KubePodCrashLooping</h1></header>',
    );
  });

  test("leaves a plain title out of the tab order", () => {
    expect(renderToStaticMarkup(<HeaderBar title="Home" />)).toContain(
      '<h1 class="ui-header-title">Home</h1>',
    );
  });
});

describe("NavTabs", () => {
  test("is a named navigation of links, the current one marked", () => {
    const html = renderToStaticMarkup(
      <NavTabs
        label="Views"
        items={[
          { href: "/a", label: "Overview", current: true },
          { href: "/b", label: "Steps", count: 4, current: false },
        ]}
      />,
    );
    expect(html).toBe(
      '<nav class="ui-tabs" aria-label="Views"><a href="/a" class="ui-tab" aria-current="page">Overview</a><a href="/b" class="ui-tab">Steps<span class="ui-tab-count">4</span></a></nav>',
    );
  });
});

describe("StatusGlyph and Chip", () => {
  test("a glyph takes a custom icon and a rich label", () => {
    const html = renderToStaticMarkup(
      <StatusGlyph
        severity="info"
        icon={ClockIcon}
        label={<a href="/q">Queued</a>}
      />,
    );
    expect(html).toContain("lucide-clock");
    expect(html).toContain('<span class="ui-glyph-label"><a href="/q">Queued');
  });

  test("a chip is a tag, a metric or a link", () => {
    expect(renderToStaticMarkup(<Chip>Manual</Chip>)).toBe(
      '<span class="ui-chip" data-kind="tag">Manual</span>',
    );
    expect(
      renderToStaticMarkup(<Chip label="Open" value={3} href="/open" />),
    ).toBe(
      '<a class="ui-chip" data-kind="metric" href="/open">Open<b class="ui-chip-value">3</b></a>',
    );
  });
});

describe("Button", () => {
  test("has a danger variant and renders links through Base UI", () => {
    expect(
      renderToStaticMarkup(<Button variant="danger">Delete</Button>),
    ).toContain('data-variant="danger"');
    const link = renderToStaticMarkup(
      <Button render={<a href="/new" />} nativeButton={false}>
        New
      </Button>,
    );
    expect(link).toMatch(/^<a href="\/new"[^>]*class="ui-btn"/);
  });
});

describe("FigureStrip", () => {
  test("names the list, wraps, links figures and adds glyphs for bad news", () => {
    const html = renderToStaticMarkup(
      <FigureStrip
        label="Summary"
        layout="wrap"
        figures={[
          { label: "Open", value: 4, href: "/open" },
          { label: "Warnings", value: 2, severity: "warning" },
          { label: "Healthy", value: 9, severity: "ok" },
        ]}
      />,
    );
    expect(html).toMatch(
      /^<dl class="ui-strip" aria-label="Summary" data-layout="wrap">/,
    );
    expect(html).toContain('<a class="ui-strip-figure" href="/open">4</a>');
    expect(html).toContain("lucide-circle-alert ui-glyph-icon");
    expect(html).toContain("</svg>2</span>");
    expect(html).toContain('<span class="ui-strip-figure">9</span>');
  });
});

describe("Banner, State and Section", () => {
  test("a banner is a quiet row: glyph and word, text, actions", () => {
    const html = renderToStaticMarkup(
      <Banner severity="warning" actions={<Button>Retry</Button>}>
        Snapshot is 12 minutes old.
      </Banner>,
    );
    expect(html).toMatch(
      /^<div class="ui-banner" data-sev="warning"><span class="ui-glyph" data-sev="warning">/,
    );
    expect(html).toContain(
      '<span class="ui-glyph-label">Warning</span></span><div class="ui-banner-text">Snapshot is 12 minutes old.</div><div class="ui-banner-actions">',
    );
  });

  test.each([
    ["loading", "status"],
    ["empty", "status"],
    ["error", "alert"],
  ] as const)("a %s state is announced as %s", (kind, role) => {
    const html = renderToStaticMarkup(<State kind={kind}>Text</State>);
    expect(html).toContain(`data-kind="${kind}" role="${role}"`);
    expect(html.includes("ui-glyph")).toBe(kind === "error");
  });

  test("a section is labelled by its heading and has head, body and foot", () => {
    const html = renderToStaticMarkup(
      <Section
        title="Firing"
        count={12}
        headingLevel={3}
        actions={<Button>Ack</Button>}
        footer="Showing 12"
      >
        <p>rows</p>
      </Section>,
    );
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(id).not.toBe("");
    expect(html).toContain(
      `<h3 class="ui-section-title" id="${id}">Firing</h3>`,
    );
    expect(html).toContain('<span class="ui-count">12</span>');
    expect(html).toContain(
      '<p>rows</p><div class="ui-section-foot">Showing 12</div></section>',
    );
  });
});

describe("Dialog", () => {
  test("renders only its trigger while closed", () => {
    const html = renderToStaticMarkup(
      <Dialog
        title="Delete go/ha?"
        actions={<Button variant="danger">Delete</Button>}
        trigger={<Button>Delete…</Button>}
      />,
    );
    expect(html).toContain("Delete…");
    expect(html).not.toContain("ui-dialog");
  });
});
