import { CircleIcon, CircleCheckIcon } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Combobox } from "@shepherdjerred/console-ui/components/pickers/combobox.tsx";
import {
  flattenOptions,
  groupOptions,
  matchesOption,
  type PickerOptions,
} from "@shepherdjerred/console-ui/components/pickers/options.tsx";
import { Select } from "@shepherdjerred/console-ui/components/pickers/select.tsx";

const noop = (): void => {
  // Static rendering never fires events.
};

const STATUSES: PickerOptions = [
  { value: "todo", label: "Todo", icon: CircleIcon },
  {
    label: "Closed",
    options: [
      {
        value: "done",
        label: "Done",
        icon: CircleCheckIcon,
        description: "Finished and verified",
      },
      { value: "cancelled", label: "Cancelled" },
    ],
  },
];

describe("picker options", () => {
  test("flatten in display order and group the loose ones first", () => {
    expect(flattenOptions(STATUSES).map(({ value }) => value)).toEqual([
      "todo",
      "done",
      "cancelled",
    ]);
    expect(groupOptions(STATUSES).map(({ label }) => label)).toEqual([
      "",
      "Closed",
    ]);
  });

  test("match every typed word in the label or description", () => {
    const [, done] = flattenOptions(STATUSES);
    if (done === undefined) throw new Error("Done is listed");
    expect(matchesOption(done, "fin ver")).toBe(true);
    expect(matchesOption(done, "DONE")).toBe(true);
    expect(matchesOption(done, "open")).toBe(false);
  });
});

describe("Select", () => {
  test("is a named 28px trigger showing the chosen option", () => {
    const html = renderToStaticMarkup(
      <Select
        label="Status"
        value="done"
        onValueChange={noop}
        options={STATUSES}
      />,
    );
    expect(html).toContain('class="ui-picker"');
    expect(html).toContain('aria-label="Status"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('<span class="ui-menu-label-text">Done</span>');
    // The closed control shows the label, not the description.
    expect(html).not.toContain("Finished and verified");
  });

  test("an unknown value shows the placeholder", () => {
    const html = renderToStaticMarkup(
      <Select
        label="Status"
        value="missing"
        placeholder="Pick a status"
        onValueChange={noop}
        options={STATUSES}
      />,
    );
    expect(html).toContain(
      '<span class="ui-picker-placeholder">Pick a status</span>',
    );
  });
});

describe("Combobox", () => {
  test("single: a named trigger showing the chosen option", () => {
    const html = renderToStaticMarkup(
      <Combobox
        label="Assignee"
        value="done"
        onValueChange={noop}
        options={STATUSES}
      />,
    );
    expect(html).toContain('class="ui-picker"');
    expect(html).toContain('aria-label="Assignee"');
    expect(html).toContain('<span class="ui-menu-label-text">Done</span>');
  });

  test("multiple: chips with remove buttons inside the control, then the input", () => {
    const html = renderToStaticMarkup(
      <Combobox
        multiple
        label="Labels"
        value={["todo", "cancelled"]}
        onValueChange={noop}
        options={STATUSES}
      />,
    );
    expect(html).toContain('data-multiple="" class="ui-picker"');
    expect(html).toContain('aria-label="Remove Todo"');
    expect(html).toContain('aria-label="Remove Cancelled"');
    expect(html).toMatch(/<input[^>]*aria-label="Labels"/);
  });

  test("a value not among the options still shows, by its value", () => {
    const html = renderToStaticMarkup(
      <Combobox
        multiple
        label="Labels"
        value={["bug"]}
        onValueChange={noop}
        options={[]}
      />,
    );
    expect(html).toContain('aria-label="Remove bug"');
  });
});
