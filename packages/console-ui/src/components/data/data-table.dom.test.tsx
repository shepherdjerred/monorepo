// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DataTable,
  type DataTableProps,
} from "@shepherdjerred/console-ui/components/data/data-table.tsx";
import type { DataTableColumn } from "@shepherdjerred/console-ui/components/data/data-table-model.ts";
import { groupBySeverity } from "@shepherdjerred/console-ui/components/data/severity-buckets.ts";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

// jsdom has no layout: it lacks these browser APIs, which the virtualizer
// and row navigation call. The browser suite covers the real behaviour.
class NoopResizeObserver {
  observe(): void {
    // jsdom never resizes.
  }
  unobserve(): void {
    // jsdom never resizes.
  }
  disconnect(): void {
    // jsdom never resizes.
  }
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);
Element.prototype.scrollIntoView = vi.fn<Element["scrollIntoView"]>();
Reflect.set(globalThis, "scrollTo", vi.fn());
// Every row measures as the 36px row token, as it does in a browser.
HTMLTableRowElement.prototype.getBoundingClientRect = () =>
  DOMRect.fromRect({ width: 800, height: 36 });

type Item = {
  readonly id: string;
  readonly name: string;
  readonly score: number | null;
  readonly severity: Severity;
};

const SEVERITIES: readonly Severity[] = ["ok", "error", "warning"];

function items(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `i${String(index + 1)}`,
    name: `item-${String(index + 1)}`,
    score: index % 4 === 0 ? null : (index * 7) % 23,
    severity: SEVERITIES[index % SEVERITIES.length] ?? "ok",
  }));
}

const COLUMNS: readonly DataTableColumn<Item>[] = [
  {
    key: "name",
    header: "Name",
    render: (row) => row.name,
    sortValue: (row) => row.name,
  },
  {
    key: "score",
    header: "Score",
    align: "right",
    render: (row) => (row.score === null ? "—" : String(row.score)),
    sortValue: (row) => row.score,
  },
];

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
});

function render(element: React.JSX.Element): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(element);
  });
  return host;
}

function table(
  props: Partial<DataTableProps<Item>> & { readonly rows: readonly Item[] },
): React.JSX.Element {
  return (
    <DataTable
      caption="Items"
      rowKey={(row) => row.id}
      rowLabel={(row) => row.name}
      columns={COLUMNS}
      {...props}
    />
  );
}

function names(container: HTMLElement): string[] {
  return [...container.querySelectorAll("tbody th[scope='row']")].map(
    (cell) => cell.textContent,
  );
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (element) =>
      element.textContent.trim() === name ||
      element.getAttribute("aria-label") === name,
  );
  if (found === undefined) {
    throw new Error(`no button "${name}"`);
  }
  return found;
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
}

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    // The prototype setter, so React sees the change as typing.
    Reflect.set(HTMLInputElement.prototype, "value", value, input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("DataTable in the DOM", () => {
  test("a header button sorts ascending, then descending, and says so", () => {
    const view = render(table({ rows: items(6), initialCap: 50 }));
    const header = view.querySelector("th[aria-sort]:nth-of-type(2)");
    expect(header?.getAttribute("aria-sort")).toBe("none");
    click(button(view, "Score"));
    expect(header?.getAttribute("aria-sort")).toBe("ascending");
    // Scores: 1→null 2→7 3→14 4→21 5→null 6→12; nulls last.
    expect(names(view)).toEqual([
      "item-2",
      "item-6",
      "item-3",
      "item-4",
      "item-1",
      "item-5",
    ]);
    expect(view.querySelector("[role='status']")?.textContent).toBe(
      "Sorted by Score, ascending, 6 rows",
    );
    click(button(view, "Score"));
    expect(header?.getAttribute("aria-sort")).toBe("descending");
    expect(names(view).slice(0, 4)).toEqual([
      "item-4",
      "item-3",
      "item-6",
      "item-2",
    ]);
    expect(names(view).slice(4)).toEqual(["item-1", "item-5"]);
  });

  test("search filters, counts and clears; filters return to their default", () => {
    const onFilter = vi.fn<(value: string) => void>();
    const view = render(
      table({
        rows: items(12),
        searchText: (row) => row.name,
        filters: [
          {
            key: "sev",
            label: "Severity",
            value: "error",
            onChange: onFilter,
            options: [
              { value: "all", label: "All" },
              { value: "error", label: "Errors" },
            ],
          },
        ],
      }),
    );
    const input = view.querySelector<HTMLInputElement>("input[type='search']");
    if (input === null) {
      throw new Error("no search field");
    }
    type(input, "ITEM-1");
    expect(names(view)).toEqual(["item-1", "item-10", "item-11", "item-12"]);
    expect(view.querySelector(".ui-filterbar-count")?.textContent).toBe(
      "4 of 12 rows",
    );
    click(button(view, "Clear filters"));
    expect(names(view)).toHaveLength(12);
    expect(onFilter).toHaveBeenCalledWith("all");
  });

  test("the cap shows N of M until Show all", () => {
    const view = render(table({ rows: items(8), initialCap: 3 }));
    expect(names(view)).toHaveLength(3);
    expect(view.textContent).toContain("Showing 3 of 8");
    click(button(view, "Show all"));
    expect(names(view)).toHaveLength(8);
    expect(view.textContent).toContain("Showing all 8");
    click(button(view, "Show top 3"));
    expect(names(view)).toHaveLength(3);
  });

  test("a twist opens and closes a row's detail", () => {
    const view = render(
      table({
        rows: items(3),
        renderExpanded: (row) => <p>{`Detail of ${row.name}`}</p>,
      }),
    );
    const twist = button(view, "Expand details for item-2");
    expect(twist.getAttribute("aria-expanded")).toBe("false");
    click(twist);
    expect(twist.getAttribute("aria-expanded")).toBe("true");
    const detail = view.querySelector(".ui-datatable-detail");
    expect(detail?.textContent).toBe("Detail of item-2");
    expect(twist.getAttribute("aria-controls")).toBe(detail?.id);
    click(twist);
    expect(view.querySelector(".ui-datatable-detail")).toBeNull();
  });

  test("select-all goes indeterminate, reports keys and clears from the bulk bar", () => {
    const onSelectionChange =
      vi.fn<(keys: readonly string[], rows: readonly Item[]) => void>();
    const view = render(
      table({
        rows: items(4),
        selectable: true,
        onSelectionChange,
        bulkActions: () => <button type="button">Archive</button>,
      }),
    );
    const all = view.querySelector<HTMLInputElement>(
      "input[aria-label='Select all rows']",
    );
    const second = view.querySelector<HTMLInputElement>(
      "input[aria-label='Select item-2']",
    );
    if (all === null || second === null) {
      throw new Error("no checkboxes");
    }
    click(second);
    expect(second.checked).toBe(true);
    expect(all.indeterminate).toBe(true);
    expect(onSelectionChange).toHaveBeenLastCalledWith(["i2"], [items(4)[1]]);
    expect(view.querySelector(".ui-bulkbar")?.textContent).toContain(
      "1 selected",
    );
    click(all);
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    expect(onSelectionChange.mock.lastCall?.[0]).toHaveLength(4);
    click(button(view, "Clear selection"));
    expect(view.querySelector(".ui-bulkbar")).toBeNull();
    expect(onSelectionChange).toHaveBeenLastCalledWith([], []);
  });
});

describe("DataTable groups, copy, keys and windowing", () => {
  test("group headings collapse their rows", () => {
    const view = render(
      table({
        rows: items(6),
        groupBy: groupBySeverity((row: Item) => row.severity),
      }),
    );
    expect(
      [...view.querySelectorAll(".ui-table-group .ui-glyph-label")].map(
        (label) => label.textContent,
      ),
    ).toEqual(["Error", "Warning", "OK"]);
    click(button(view, "Collapse Error"));
    expect(names(view)).toEqual(["item-3", "item-6", "item-1", "item-4"]);
    click(button(view, "Expand Error"));
    expect(names(view)).toHaveLength(6);
  });

  test("copy writes CSV to the clipboard and announces it", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {
      await Promise.resolve();
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const view = render(table({ rows: items(2), exportFilename: "items" }));
    await act(async () => {
      button(view, "Copy CSV").click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("Name,Score\nitem-1,\nitem-2,7");
    expect(view.querySelector("[role='status']")?.textContent).toBe(
      "Copied 2 rows as CSV (items)",
    );
    expect(button(view, "Copied CSV")).toBeDefined();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  test("j and k move the current row; Enter opens it; typing is left alone", () => {
    const opened: string[] = [];
    function Harness(): React.JSX.Element {
      const [current, setCurrent] = useState<string | undefined>();
      return table({
        rows: items(3),
        keyboardNavigation: true,
        currentRowKey: current,
        onCurrentRowChange: setCurrent,
        onRowOpen: (row) => opened.push(row.id),
        searchText: (row) => row.name,
      });
    }
    const view = render(<Harness />);
    const currentName = () =>
      view.querySelector("tr[data-current] th")?.textContent;
    press("j");
    expect(currentName()).toBe("item-1");
    press("j");
    press("j");
    press("j");
    expect(currentName()).toBe("item-3");
    press("k");
    expect(currentName()).toBe("item-2");
    press("Enter");
    expect(opened).toEqual(["i2"]);
    const input = view.querySelector("input[type='search']");
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true }),
      );
    });
    expect(currentName()).toBe("item-2");
  });

  test("past 200 rows a virtualized table renders only a window and no cap", () => {
    const view = render(table({ rows: items(300), virtualize: true }));
    const rendered = names(view).length;
    expect(rendered).toBeGreaterThan(0);
    // jsdom has no layout, so the window it picks is not a browser's; the
    // Hub gallery's Playwright spec checks the real window and scrolling.
    expect(rendered).toBeLessThan(300);
    expect(
      view.querySelector(".ui-datatable")?.hasAttribute("data-page-sticky"),
    ).toBe(true);
    expect(view.querySelector("table")?.hasAttribute("data-sticky")).toBe(true);
    // No cap while virtualized: the count still says all 300 match.
    expect(view.textContent).not.toContain("Show all");
  });

  test("below the threshold a virtualize table renders every row", () => {
    const view = render(
      table({
        rows: items(150),
        virtualize: { maxHeight: 400 },
        initialCap: 500,
      }),
    );
    expect(names(view)).toHaveLength(150);
  });
});
