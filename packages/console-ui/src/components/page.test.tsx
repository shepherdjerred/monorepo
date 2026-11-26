import { renderToStaticMarkup } from "react-dom/server";
import { PlusIcon } from "lucide-react";
import { describe, expect, test } from "vitest";
import { Button } from "@shepherdjerred/console-ui/components/button.tsx";
import {
  Card,
  CardToolbar,
  PageBody,
  PageHeading,
  SummaryGrid,
  Tag,
} from "@shepherdjerred/console-ui/components/page.tsx";
import { SearchField } from "@shepherdjerred/console-ui/components/search-field.tsx";
import { Segmented } from "@shepherdjerred/console-ui/components/segmented.tsx";
import { TopBar } from "@shepherdjerred/console-ui/components/top-bar.tsx";
import { createThemeStore } from "@shepherdjerred/console-ui/theme.ts";

const noop = (): void => {
  // Static rendering never fires events.
};

describe("PageBody and PageHeading", () => {
  const html = renderToStaticMarkup(
    <PageBody>
      <PageHeading
        eyebrow="Shortlink directory"
        title="Go links"
        description="69 routes"
        actions={<Button size="page">New link</Button>}
      />
    </PageBody>,
  );

  test("the body is the page's main landmark", () => {
    expect(html).toMatch(/^<main class="ui-page">/);
  });

  test("the title is the h1, after the eyebrow", () => {
    expect(html).toContain(
      '<p class="ui-eyebrow">Shortlink directory</p><h1 class="ui-page-title">Go links</h1><p class="ui-page-lede">69 routes</p>',
    );
  });

  test("actions sit in their own group", () => {
    expect(html).toMatch(/<div class="ui-page-actions"><button[^>]*>/);
  });

  test("description and actions are optional", () => {
    const bare = renderToStaticMarkup(
      <PageHeading eyebrow="Kicker" title="Title" />,
    );
    expect(bare).not.toContain("ui-page-lede");
    expect(bare).not.toContain("ui-page-actions");
  });
});

describe("SummaryGrid", () => {
  const html = renderToStaticMarkup(
    <SummaryGrid
      label="Link summary"
      items={[
        { label: "Links", value: 69 },
        { label: "Broken", value: 2, severity: "error" },
      ]}
    />,
  );

  test("is a named description list of label/value pairs", () => {
    expect(html).toMatch(/^<dl class="ui-summary" aria-label="Link summary">/);
    expect(html).toContain(
      '<div class="ui-summary-card"><dt>Links</dt><dd>69</dd></div>',
    );
  });

  test("a severity colours its card", () => {
    expect(html).toContain('<div class="ui-summary-card" data-sev="error">');
  });
});

describe("Card, CardToolbar and Tag", () => {
  test("a named card is a labelled section", () => {
    const html = renderToStaticMarkup(
      <Card label="Links" id="links">
        <CardToolbar>tools</CardToolbar>
      </Card>,
    );
    expect(html).toBe(
      '<section class="ui-card" aria-label="Links" id="links"><div class="ui-card-toolbar">tools</div></section>',
    );
  });

  test("a tag carries its title", () => {
    expect(renderToStaticMarkup(<Tag title="Tailscale">Tailnet</Tag>)).toBe(
      '<span class="ui-tag" title="Tailscale">Tailnet</span>',
    );
  });
});

describe("Button sizes", () => {
  test("defaults to compact and marks the page size", () => {
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain(
      'data-size="compact"',
    );
    const page = renderToStaticMarkup(
      <Button size="page">
        <PlusIcon aria-hidden="true" />
        New link
      </Button>,
    );
    expect(page).toContain('data-size="page"');
    expect(page).toContain('class="ui-btn"');
  });
});

describe("SearchField", () => {
  const html = renderToStaticMarkup(
    <SearchField
      label="Search links"
      placeholder="Search…"
      value=""
      onChange={noop}
    />,
  );

  test("is a label wrapping a hidden name, the icon and a search input", () => {
    expect(html).toMatch(
      /^<label class="ui-search"><span class="ui-sr-only">Search links<\/span><svg[^>]*aria-hidden="true"/,
    );
    expect(html).toMatch(/<input[^>]*type="search"[^>]*class="ui-input"/);
    expect(html).toContain('placeholder="Search…"');
  });
});

describe("Segmented", () => {
  const html = renderToStaticMarkup(
    <Segmented
      label="Source"
      value="manual"
      options={[
        { value: "all", label: "All", count: 69 },
        { value: "manual", label: "Manual", count: 4 },
      ]}
      onChange={noop}
    />,
  );

  test("is a named radio group", () => {
    expect(html).toMatch(
      /^<div class="ui-segmented" role="radiogroup" aria-label="Source">/,
    );
  });

  test("only the checked option is in the tab order", () => {
    expect(html).toContain(
      '<button type="button" role="radio" aria-checked="false" tabindex="-1">All<span class="ui-segmented-count">69</span></button>',
    );
    expect(html).toContain(
      '<button type="button" role="radio" aria-checked="true" tabindex="0">Manual<span class="ui-segmented-count">4</span></button>',
    );
  });
});

describe("TopBar", () => {
  const theme = createThemeStore("test-theme", {
    storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
    darkQuery: { matches: false, addEventListener: noop },
    root: { dataset: {} },
    onStorage: noop,
  });
  const html = renderToStaticMarkup(
    <TopBar
      switcher={<span>switcher</span>}
      brand="Go links"
      navLabel="Go links"
      theme={theme}
      actions={<span>search</span>}
    >
      {() => <span>nav</span>}
    </TopBar>,
  );

  test("is a header with the menu button, switcher, actions and theme", () => {
    expect(html).toMatch(/^<header class="ui-topbar"><button[^>]*>/);
    expect(html).toContain('aria-label="Open navigation"');
    expect(html).toContain("<span>switcher</span><span>search</span>");
    expect(html).toContain('aria-label="Theme: system. Switch to light."');
  });

  test("keeps the drawer and its navigation unmounted while closed", () => {
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("nav</span>");
  });
});
