import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  EnumPicker,
  FallbackEnumPicker,
  NativeEnumPicker,
  customSelect,
  type EnumPickerProps,
} from "./enum-picker.tsx";

const props: EnumPickerProps = {
  label: "Status",
  value: "started",
  options: [
    { value: "unstarted", label: "Todo" },
    {
      value: "started",
      label: "In progress",
      icon: <svg data-icon="started" />,
    },
  ],
  onChange: () => {
    // Rendering only.
  },
  id: "property-state",
};

// The browser end-to-end suite runs Chromium, which has the customizable
// select; these cover both paths from one set of props.
describe("enum picker", () => {
  test("the customizable select is a real select whose button mirrors the choice", () => {
    const html = renderToStaticMarkup(<NativeEnumPicker {...props} />);
    expect(html).toMatch(
      /^<select class="picker picker-field" id="property-state" aria-label="Status"/u,
    );
    expect(html).toContain(
      '<button class="picker-button"><selectedcontent></selectedcontent></button>',
    );
    expect(html).toContain('<option value="started" selected="">');
    expect(html).toContain('data-icon="started"');
  });

  test("an action picker keeps a fixed label and selects nothing", () => {
    const html = renderToStaticMarkup(
      <NativeEnumPicker
        {...props}
        variant="action"
        action={{ text: "Status", icon: <svg /> }}
      />,
    );
    expect(html).toContain(
      '<option value="" disabled="" hidden="" selected="">Status</option>',
    );
    expect(html).not.toContain("<selectedcontent>");
  });

  test("elsewhere the same props render a Base UI select trigger", () => {
    const html = renderToStaticMarkup(<FallbackEnumPicker {...props} />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="Status"');
    expect(html).toContain('id="property-state"');
    expect(html).toContain("In progress");
    expect(html).not.toContain("<select");
  });

  test("without the customizable select, the picker falls back", () => {
    expect(customSelect).toBe(false);
    expect(renderToStaticMarkup(<EnumPicker {...props} />)).toBe(
      renderToStaticMarkup(<FallbackEnumPicker {...props} />),
    );
  });
});
