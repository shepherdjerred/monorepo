import { FolderIcon } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  CommandPaletteSearch,
  createCommandPaletteStore,
} from "@shepherdjerred/console-ui/components/command-palette.tsx";
import {
  CommandPaletteCommands,
  matchesCommand,
  type PaletteCommand,
} from "@shepherdjerred/console-ui/components/palette/palette-commands.tsx";
import { createRecentCommands } from "@shepherdjerred/console-ui/components/palette/recent-commands.ts";

const noop = (): void => {
  // Static rendering never fires events.
};

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("CommandPaletteSearch steps", () => {
  const store = createCommandPaletteStore(null);
  const html = renderToStaticMarkup(
    <CommandPaletteSearch
      store={store}
      label="Search and commands"
      query=""
      onQueryChange={noop}
      sections={[
        {
          heading: "Status",
          items: [
            { id: "todo", label: "Todo", icon: FolderIcon, checked: true },
            { id: "done", label: "Done", icon: FolderIcon, hint: "Mod+D" },
          ],
        },
      ]}
      onSelect={noop}
      breadcrumb={["AI-12", "Set status"]}
      onBack={noop}
    />,
  );

  test("shows a back button and the trail before the input", () => {
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('<span class="ui-palette-crumb">AI-12</span>');
    expect(html).toContain('<span class="ui-palette-crumb">Set status</span>');
    expect(html).toContain(
      'aria-label="Search and commands: AI-12, Set status"',
    );
  });

  test("marks the current value and shows a shortcut hint", () => {
    expect(html).toContain('ui-palette-check" aria-label="Current"');
    expect(html).toContain('<span class="ui-keys" aria-hidden="true">');
  });

  test("the footer says Escape goes back", () => {
    expect(html).toContain("<kbd>Esc</kbd> back");
    expect(html).toContain("choose");
  });
});

describe("CommandPaletteCommands", () => {
  const store = createCommandPaletteStore(null);
  const go: PaletteCommand<{ navigate: (to: string) => void }> = {
    id: "nav-issues",
    label: "Unresolved issues",
    detail: "/issues",
    keywords: "inbox triage",
    icon: FolderIcon,
    run: ({ navigate }) => {
      navigate("/issues");
    },
  };
  const theme: PaletteCommand<{ navigate: (to: string) => void }> = {
    id: "theme",
    label: "Cycle theme",
    icon: FolderIcon,
  };

  test("matches every typed word in the label, detail or keywords", () => {
    expect(matchesCommand(go, "triage /iss")).toBe(true);
    expect(matchesCommand(go, "releases")).toBe(false);
  });

  test("lists recent commands first while nothing is typed", () => {
    const recent = createRecentCommands({
      key: "test",
      storage: memoryStorage(),
    });
    recent.remember("theme");
    const html = renderToStaticMarkup(
      <CommandPaletteCommands
        store={store}
        label="Search and commands"
        context={{ navigate: noop }}
        sections={[
          { heading: "Pages", items: [go] },
          { heading: "Commands", items: [theme] },
        ]}
        recent={recent}
      />,
    );
    expect(html.indexOf('aria-label="Recent"')).toBeLessThan(
      html.indexOf('aria-label="Pages"'),
    );
    // A recent command is listed once, under Recent.
    expect(html).not.toContain('aria-label="Commands"');
  });
});

describe("createRecentCommands", () => {
  test("keeps the newest first, without repeats, up to the limit", () => {
    const storage = memoryStorage();
    const recent = createRecentCommands({ key: "k", limit: 2, storage });
    recent.remember("a");
    recent.remember("b");
    recent.remember("a");
    recent.remember("c");
    expect(recent.ids()).toEqual(["c", "a"]);
    expect(createRecentCommands({ key: "k", storage }).ids()).toEqual([
      "c",
      "a",
    ]);
    recent.clear();
    expect(recent.ids()).toEqual([]);
  });

  test("reads corrupt or blocked storage as no history", () => {
    const storage = memoryStorage();
    storage.setItem("k", "{not json");
    expect(createRecentCommands({ key: "k", storage }).ids()).toEqual([]);
    storage.setItem("k", JSON.stringify([1, 2]));
    expect(createRecentCommands({ key: "k", storage }).ids()).toEqual([]);
    expect(createRecentCommands({ key: "k", storage: null }).ids()).toEqual([]);
  });
});
