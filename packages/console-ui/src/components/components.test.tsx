import { renderToStaticMarkup } from "react-dom/server";
import {
  HouseIcon,
  MinusIcon,
  RefreshCwIcon,
  TerminalIcon,
} from "lucide-react";
import { describe, expect, test } from "vitest";
import { AppSwitcher } from "@shepherdjerred/console-ui/components/shell/app-switcher.tsx";
import { Button } from "@shepherdjerred/console-ui/components/button.tsx";
import { Chip } from "@shepherdjerred/console-ui/components/chip.tsx";
import {
  CommandPaletteButton,
  CommandPaletteSearch,
  createCommandPaletteStore,
  isCommandPaletteShortcut,
  type CommandPaletteKeyEvent,
} from "@shepherdjerred/console-ui/components/command-palette.tsx";
import { Field } from "@shepherdjerred/console-ui/components/field.tsx";
import { FigureStrip } from "@shepherdjerred/console-ui/components/figure-strip.tsx";
import { HeaderBar } from "@shepherdjerred/console-ui/components/header-bar.tsx";
import { IconButton } from "@shepherdjerred/console-ui/components/icon-button.tsx";
import { Meter } from "@shepherdjerred/console-ui/components/meter.tsx";
import { SeverityBadge } from "@shepherdjerred/console-ui/components/page-kit/severity-badge.tsx";
import { ShellFrame } from "@shepherdjerred/console-ui/components/shell/shell-frame.tsx";
import {
  Sidebar,
  SidebarGroup,
} from "@shepherdjerred/console-ui/components/shell/sidebar.tsx";
import { SidebarItem } from "@shepherdjerred/console-ui/components/shell/sidebar-item.tsx";
import { StatusGlyph } from "@shepherdjerred/console-ui/components/status-glyph.tsx";
import {
  Tabs,
  tabTargetIndex,
} from "@shepherdjerred/console-ui/components/tabs.tsx";
import { ThemeRow } from "@shepherdjerred/console-ui/components/shell/theme-row.tsx";
import { createThemeStore } from "@shepherdjerred/console-ui/theme.ts";

const noop = (): void => {
  // Static rendering never fires events.
};

describe("ShellFrame", () => {
  test("puts the sidebar beside a panel that is not a scroll container", () => {
    const html = renderToStaticMarkup(
      <ShellFrame sidebar={<aside>side</aside>}>
        <main>content</main>
      </ShellFrame>,
    );
    expect(html).toBe(
      '<div class="ui-shell"><aside>side</aside><div class="ui-panel"><main>content</main></div></div>',
    );
  });
});

describe("Sidebar navigation", () => {
  const html = renderToStaticMarkup(
    <Sidebar top={<span>top</span>} footer={<span>foot</span>}>
      <SidebarGroup label="Ops">
        <SidebarItem
          href="/"
          label="Home"
          icon={HouseIcon}
          count={143}
          current
        />
        <SidebarItem href="/cluster" label="Cluster" />
      </SidebarGroup>
    </Sidebar>,
  );

  test("names the navigation landmark", () => {
    expect(html).toContain('<nav class="ui-nav" aria-label="Primary">');
  });

  test("names the aside landmark only when given a label", () => {
    expect(html).toMatch(/^<aside class="ui-side">/);
    const labelled = renderToStaticMarkup(
      <Sidebar label="Hub">
        <SidebarGroup label="Ops">
          <SidebarItem href="/" label="Home" />
        </SidebarGroup>
      </Sidebar>,
    );
    expect(labelled).toMatch(/^<aside class="ui-side" aria-label="Hub">/);
  });

  test("renders each group as a labelled ul > li > a list", () => {
    const labelId = /<p class="ui-nav-label" id="([^"]+)">Ops<\/p>/.exec(
      html,
    )?.[1];
    expect(labelId).toBeDefined();
    expect(html).toContain(
      `<ul class="ui-nav-list" aria-labelledby="${labelId ?? ""}"><li><a href="/" class="ui-nav-item" aria-current="page">`,
    );
    expect(html).toContain(
      '<li><a href="/cluster" class="ui-nav-item"><span class="ui-nav-text">Cluster</span></a></li>',
    );
  });

  test("hides the icon and shows the count", () => {
    expect(html).toMatch(
      /<svg[^>]*class="[^"]*ui-nav-icon"[^>]*aria-hidden="true"/,
    );
    expect(html).toContain('<span class="ui-nav-count">143</span>');
  });

  test("lets a router render the anchor", () => {
    const routed = renderToStaticMarkup(
      <SidebarItem
        href="/alerts"
        label="Active"
        renderLink={(props) => (
          <a
            data-router="yes"
            href={props.href}
            className={props.className}
            aria-current={props["aria-current"]}
          >
            {props.children}
          </a>
        )}
      />,
    );
    expect(routed).toMatch(
      /^<li><a data-router="yes" href="\/alerts" class="ui-nav-item">/,
    );
  });
});

describe("AppSwitcher", () => {
  test("is a menu button named after the current app", () => {
    const html = renderToStaticMarkup(
      <AppSwitcher
        current={{ label: "Hub", mark: "H" }}
        apps={[
          { label: "Hub", url: "https://hub.example/", group: "Consoles" },
          { label: "Flags", url: "https://flags.example/", group: "Consoles" },
        ]}
      />,
    );
    expect(html).toMatch(/^<button[^>]*aria-haspopup="menu"/);
    expect(html).toContain('class="ui-workspace"');
    expect(html).toContain(
      '<span class="ui-workspace-mark" aria-hidden="true">H</span>',
    );
    expect(html).toContain('<span class="ui-workspace-label">Hub</span>');
    expect(html).toContain('<span class="ui-sr-only">, switch app</span>');
  });
});

describe("HeaderBar and Tabs", () => {
  const html = renderToStaticMarkup(
    <HeaderBar
      title="Home"
      tabs={
        <Tabs
          label="Show"
          value="all"
          onChange={noop}
          options={[
            { value: "all", label: "All", count: 143 },
            { value: "waiting", label: "Waiting on you", count: 123 },
          ]}
        />
      }
      meta="Snapshot generated 1m ago"
      actions={<Button>Refresh</Button>}
    />,
  );

  test("titles the page with an h1", () => {
    expect(html).toContain('<h1 class="ui-header-title">Home</h1>');
  });

  test("renders a radio group with one tab stop on the selection", () => {
    expect(html).toContain('role="radiogroup" aria-label="Show"');
    expect(html).toContain(
      '<button type="button" role="radio" class="ui-tab" aria-checked="true" tabindex="0">All<span class="ui-tab-count">143</span></button>',
    );
    expect(html).toContain(
      '<button type="button" role="radio" class="ui-tab" aria-checked="false" tabindex="-1">Waiting on you',
    );
  });

  test.each([
    ["ArrowRight", 0, 1],
    ["ArrowDown", 1, 0],
    ["ArrowLeft", 0, 1],
    ["ArrowUp", 1, 0],
    ["Home", 1, 0],
    ["End", 0, 1],
  ] as const)("%s from %i selects %i", (key, from, to) => {
    expect(tabTargetIndex(key, from, 2)).toBe(to);
  });

  test("ignores other keys", () => {
    expect(tabTargetIndex("Enter", 0, 2)).toBeUndefined();
  });
});

describe("FigureStrip", () => {
  test("renders a description list of figures", () => {
    const html = renderToStaticMarkup(
      <FigureStrip
        figures={[
          { label: "Firing alerts", value: 15, hint: "in 13 groups" },
          { label: "Critical", value: 1, severity: "error" },
        ]}
      />,
    );
    expect(html.slice(0, html.indexOf("<svg") + 4)).toBe(
      '<dl class="ui-strip">' +
        '<div class="ui-strip-cell"><dt class="ui-strip-label">Firing alerts</dt><dd class="ui-strip-value"><span class="ui-strip-figure">15</span><span class="ui-strip-hint">in 13 groups</span></dd></div>' +
        '<div class="ui-strip-cell" data-sev="error"><dt class="ui-strip-label">Critical</dt><dd class="ui-strip-value"><span class="ui-strip-figure"><svg',
    );
    expect(html).toContain("</svg>1</span></dd></div></dl>");
  });
});

describe("StatusGlyph", () => {
  test("shows the severity word next to a hidden icon", () => {
    const html = renderToStaticMarkup(<StatusGlyph severity="warning" />);
    expect(html).toMatch(
      /^<span class="ui-glyph" data-sev="warning"><svg[^>]*aria-hidden="true"/,
    );
    expect(html).toContain('<span class="ui-glyph-label">Warning</span>');
  });

  test("keeps an accessible name when the label is hidden", () => {
    const html = renderToStaticMarkup(
      <StatusGlyph severity="error" label="Critical" hideLabel />,
    );
    expect(html).toContain('<span class="ui-sr-only">Critical</span>');
  });

  test.each(["ok", "info", "unknown", "warning", "error"] as const)(
    "%s has a default name",
    (severity) => {
      const html = renderToStaticMarkup(
        <StatusGlyph severity={severity} hideLabel />,
      );
      expect(html).toMatch(/<span class="ui-sr-only">[A-Z][A-Za-z]+<\/span>/);
    },
  );
});

describe("Meter", () => {
  test("exposes a named meter with its figure", () => {
    const html = renderToStaticMarkup(
      <Meter value={97} severity="error" label="modelScoped quota" />,
    );
    expect(html).toContain(
      'role="meter" aria-label="modelScoped quota" aria-valuemin="0" aria-valuemax="100" aria-valuenow="97" aria-valuetext="97%"',
    );
    expect(html).toContain('style="width:97%"');
    expect(html).toContain(
      '<span class="ui-meter-text" aria-hidden="true">97%</span>',
    );
  });

  test("fills the bar past max but reports the true figure", () => {
    const html = renderToStaticMarkup(
      <Meter value={118} severity="warning" label="API spend" />,
    );
    expect(html).toContain('aria-valuenow="100" aria-valuetext="118%"');
    expect(html).toContain('style="width:100%"');
  });

  test("uses caller text for counts", () => {
    const html = renderToStaticMarkup(
      <Meter value={5} max={13} severity="warning" label="Issues" text="5" />,
    );
    expect(html).toContain(
      'aria-valuemax="13" aria-valuenow="5" aria-valuetext="5"',
    );
  });
});

describe("Chip", () => {
  test("pairs a label with a mono value", () => {
    expect(
      renderToStaticMarkup(
        <Chip label="Projected month" value="$118.20" severity="warning" />,
      ),
    ).toBe(
      '<span class="ui-chip" data-kind="metric" data-sev="warning">Projected month<b class="ui-chip-value">$118.20</b></span>',
    );
  });
});

describe("Button and IconButton", () => {
  test("Button is a typed button with a variant", () => {
    const html = renderToStaticMarkup(
      <Button variant="primary">
        <RefreshCwIcon aria-hidden="true" />
        Refresh
      </Button>,
    );
    expect(html).toMatch(
      /^<button type="button"[^>]*data-variant="primary" data-size="compact" class="ui-btn">/,
    );
    expect(html).toContain("Refresh</button>");
  });

  test("IconButton is named by its label", () => {
    const html = renderToStaticMarkup(
      <IconButton icon={RefreshCwIcon} label="Search" />,
    );
    expect(html).toContain('aria-label="Search"');
    expect(html).toContain('class="ui-icon-btn"');
  });
});

describe("Field", () => {
  test("labels the control and describes it with hint and error", () => {
    const html = renderToStaticMarkup(
      <Field label="Namespace" hint="Kubernetes namespace" error="Required">
        {(control) => <input {...control} />}
      </Field>,
    );
    const id =
      /<label class="ui-field-label" for="([^"]+)">Namespace<\/label>/.exec(
        html,
      )?.[1];
    expect(id).toBeDefined();
    const safeId = id ?? "";
    expect(html).toContain(
      `<input id="${safeId}" class="ui-field-control" aria-describedby="${safeId}-hint ${safeId}-error" aria-invalid="true"/>`,
    );
    expect(html).toContain(
      `<p class="ui-field-error" id="${safeId}-error">Required</p>`,
    );
    expect(html).toContain("data-invalid");
  });

  test("a valid field has no description or invalid state", () => {
    const html = renderToStaticMarkup(
      <Field label="Severity" layout="inline">
        {(control) => (
          <select {...control}>
            <option>All</option>
          </select>
        )}
      </Field>,
    );
    expect(html).toContain('data-layout="inline"');
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("aria-invalid");
  });
});

describe("ThemeRow", () => {
  test("names the current preference", () => {
    const store = createThemeStore("ops-theme", {
      storage: () => ({
        getItem: () => "dark",
        setItem: noop,
        removeItem: noop,
      }),
      darkQuery: { matches: false, addEventListener: noop },
      root: { dataset: {} },
      onStorage: noop,
    });
    const html = renderToStaticMarkup(<ThemeRow store={store} />);
    expect(html).toMatch(
      /^<button type="button" class="ui-nav-item ui-theme-row" aria-label="Theme: dark">/,
    );
    expect(html).toContain('<span class="ui-nav-count">dark</span>');
    // Visible text "Theme dark" sits inside the name "Theme: dark".
    expect(html).toContain(
      '<span class="ui-nav-text">Theme</span> <span class="ui-nav-count">dark</span>',
    );
  });
});

describe("SeverityBadge", () => {
  test.each([
    ["ok", "OK"],
    ["info", "Info"],
    ["unknown", "Unknown"],
    ["warning", "Warning"],
    ["error", "Error"],
  ] as const)("%s shows a hidden glyph and the word %s", (severity, word) => {
    const html = renderToStaticMarkup(<SeverityBadge severity={severity} />);
    expect(html).toMatch(
      new RegExp(
        `^<span class="ui-badge" data-sev="${severity}"><svg[^>]*class="[^"]*ui-badge-icon"[^>]*aria-hidden="true"`,
      ),
    );
    expect(html).toMatch(new RegExp(`</svg>${word}</span>$`));
  });

  test("takes a glyph of its own and keeps the severity colour", () => {
    const html = renderToStaticMarkup(
      <SeverityBadge severity="unknown" label="Off" icon={MinusIcon} />,
    );
    expect(html).toMatch(/^<span class="ui-badge" data-sev="unknown"><svg/);
    expect(html).toContain("lucide-minus");
    expect(html).toMatch(/<\/svg>Off<\/span>$/);
  });

  test("renames and enlarges", () => {
    const html = renderToStaticMarkup(
      <SeverityBadge severity="error" label="Critical" size="large" />,
    );
    expect(html).toMatch(
      /^<span class="ui-badge ui-badge-large" data-sev="error">/,
    );
    expect(html).toMatch(/<\/svg>Critical<\/span>$/);
  });
});

function keyTarget(): {
  readonly target: {
    addEventListener: (
      type: "keydown",
      listener: (event: CommandPaletteKeyEvent) => void,
    ) => void;
  };
  readonly press: (key: Partial<CommandPaletteKeyEvent>) => boolean;
} {
  let handler: ((event: CommandPaletteKeyEvent) => void) | undefined;
  return {
    target: {
      addEventListener: (_type, listener) => {
        handler = listener;
      },
    },
    press: (key) => {
      let prevented = false;
      handler?.({
        key: "k",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        ...key,
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}

describe("Command palette", () => {
  test.each([
    [{ key: "k", metaKey: true }, true],
    [{ key: "K", ctrlKey: true }, true],
    [{ key: "k" }, false],
    [{ key: "k", metaKey: true, shiftKey: true }, false],
    [{ key: "k", ctrlKey: true, altKey: true }, false],
    [{ key: "j", metaKey: true }, false],
  ])("%o is the shortcut: %s", (key, expected) => {
    expect(
      isCommandPaletteShortcut({
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        ...key,
      }),
    ).toBe(expected);
  });

  test("the store toggles on the shortcut and notifies subscribers", () => {
    const keys = keyTarget();
    const store = createCommandPaletteStore(keys.target);
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    expect(store.isOpen()).toBe(false);
    expect(keys.press({ metaKey: true })).toBe(true);
    expect(store.isOpen()).toBe(true);
    expect(keys.press({ key: "a", metaKey: true })).toBe(false);
    expect(store.isOpen()).toBe(true);
    keys.press({ ctrlKey: true });
    expect(store.isOpen()).toBe(false);
    store.setOpen(false);
    expect(notified).toBe(2);
    unsubscribe();
    store.setOpen(true);
    expect(notified).toBe(2);
  });

  test("the search box is a combobox over grouped options", () => {
    const store = createCommandPaletteStore(null);
    const html = renderToStaticMarkup(
      <CommandPaletteSearch
        store={store}
        label="Search and commands"
        placeholder="Type a command…"
        query=""
        onQueryChange={noop}
        onSelect={noop}
        sections={[
          {
            heading: "Pages",
            items: [{ id: "home", label: "Home", icon: HouseIcon }],
          },
          {
            heading: "Commands",
            items: [
              {
                id: "cli",
                label: "Open terminal",
                detail: "⌘T",
                icon: TerminalIcon,
              },
            ],
          },
        ]}
      />,
    );
    const listbox = /aria-controls="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(listbox).not.toBe("");
    expect(html).toContain(
      `<div class="ui-palette-results" id="${listbox}" role="listbox">`,
    );
    expect(html).toContain('role="combobox" aria-label="Search and commands"');
    expect(html).toContain('placeholder="Type a command…"');
    const options = [
      ...html.matchAll(
        /<button id="([^"]+)" type="button" role="option" tabindex="-1" aria-selected="(true|false)" class="ui-palette-option">/g,
      ),
    ];
    expect(options.map((option) => option[2])).toEqual(["true", "false"]);
    expect(html).toContain(`aria-activedescendant="${options[0]?.[1] ?? ""}"`);
    expect(html).toContain('<div role="group" aria-label="Pages">');
    expect(html).toContain(
      '<span class="ui-palette-label">Open terminal</span><span class="ui-palette-detail">⌘T</span>',
    );
    expect(html).toContain('<p class="ui-palette-status" role="status"></p>');
  });

  test("an empty list says so unless the caller sets the status", () => {
    const store = createCommandPaletteStore(null);
    const empty = renderToStaticMarkup(
      <CommandPaletteSearch
        store={store}
        label="Search"
        query="zzz"
        onQueryChange={noop}
        onSelect={noop}
        sections={[]}
      />,
    );
    expect(empty).toContain('role="status">No results.</p>');
    expect(empty).not.toContain("aria-activedescendant");
    const searching = renderToStaticMarkup(
      <CommandPaletteSearch
        store={store}
        label="Search"
        query="zzz"
        onQueryChange={noop}
        onSelect={noop}
        sections={[]}
        status="Searching…"
      />,
    );
    expect(searching).toContain('role="status">Searching…</p>');
  });

  test("the sidebar button names the shortcut", () => {
    const html = renderToStaticMarkup(
      <CommandPaletteButton
        store={createCommandPaletteStore(null)}
        label="Search and commands"
      />,
    );
    expect(html).toContain('aria-keyshortcuts="Meta+K Control+K"');
    expect(html).toContain('title="Search (⌘K)"');
    expect(html).toContain('aria-label="Search and commands"');
    expect(html).toContain('class="ui-icon-btn"');
  });
});
