import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BackLink } from "@shepherdjerred/console-ui/components/detail/back-link.tsx";
import { CodeBlock } from "@shepherdjerred/console-ui/components/detail/code-block.tsx";
import { CopyButton } from "@shepherdjerred/console-ui/components/detail/copy-button.tsx";
import { DescriptionList } from "@shepherdjerred/console-ui/components/detail/description-list.tsx";
import { Disclosure } from "@shepherdjerred/console-ui/components/detail/disclosure.tsx";
import {
  ListToggle,
  Pager,
  cappedCount,
  type Capped,
} from "@shepherdjerred/console-ui/components/detail/pager.tsx";
import { EmailPreview } from "@shepherdjerred/console-ui/components/feedback/email-preview.tsx";
import { Kbd } from "@shepherdjerred/console-ui/components/feedback/kbd.tsx";
import { SavedStatus } from "@shepherdjerred/console-ui/components/feedback/saved-status.tsx";
import { Skeleton } from "@shepherdjerred/console-ui/components/feedback/skeleton.tsx";
import { StatusDot } from "@shepherdjerred/console-ui/components/feedback/status-dot.tsx";
import {
  collectErrorSummary,
  fieldErrorMessage,
} from "@shepherdjerred/console-ui/components/forms/bind-field.ts";
import { Checkbox } from "@shepherdjerred/console-ui/components/forms/checkbox.tsx";
import { ErrorSummary } from "@shepherdjerred/console-ui/components/forms/error-summary.tsx";
import { Fieldset } from "@shepherdjerred/console-ui/components/forms/fieldset.tsx";
import { FormActions } from "@shepherdjerred/console-ui/components/forms/form-actions.tsx";
import { InputAddon } from "@shepherdjerred/console-ui/components/forms/input-addon.tsx";
import { RadioGroup } from "@shepherdjerred/console-ui/components/forms/radio-group.tsx";
import { Switch } from "@shepherdjerred/console-ui/components/forms/switch.tsx";
import { Textarea } from "@shepherdjerred/console-ui/components/forms/textarea.tsx";
import { Duration } from "@shepherdjerred/console-ui/components/time/duration.tsx";
import { ExactTime } from "@shepherdjerred/console-ui/components/time/exact-time.tsx";
import { RelativeTime } from "@shepherdjerred/console-ui/components/time/relative-time.tsx";

const noop = (): void => {
  // The list is rendered statically; the toggle never fires.
};

const NOW = "2026-11-26T22:02:09Z";

describe("DescriptionList", () => {
  const html = renderToStaticMarkup(
    <DescriptionList
      layout="rail"
      label="Alert facts"
      items={[
        { label: "Fingerprint", value: "9f2c", mono: true },
        { label: "Status", value: "Firing", severity: "error" },
        { label: "Summary", value: "Pod restarts", wide: true },
      ]}
    />,
  );

  test("renders dl, div, dt and dd with the layout", () => {
    expect(html).toContain('<dl class="ui-dl" data-layout="rail"');
    expect(html).toContain('aria-label="Alert facts"');
    expect(html.match(/<div class="ui-dl-item"/g)).toHaveLength(3);
    expect(html).toContain("<dt>Fingerprint</dt>");
  });

  test("marks mono, severity and wide items", () => {
    expect(html).toContain('<dd class="ui-mono">9f2c</dd>');
    expect(html).toContain('data-sev="error"');
    expect(html).toContain("data-wide");
  });
});

describe("Disclosure", () => {
  test("is a native details with a count, closed by default", () => {
    const html = renderToStaticMarkup(
      <Disclosure title="Labels" count={4}>
        body
      </Disclosure>,
    );
    expect(html).toMatch(/^<details class="ui-disclosure"><summary/);
    expect(html).toContain('<span class="ui-count">4</span>');
    expect(html).not.toContain(" open");
  });

  test("opens by default on request", () => {
    expect(
      renderToStaticMarkup(
        <Disclosure title="Labels" defaultOpen>
          body
        </Disclosure>,
      ),
    ).toContain('<details class="ui-disclosure" open="">');
  });
});

describe("CodeBlock", () => {
  test("is a focusable labelled region with numbered, highlighted lines", () => {
    const html = renderToStaticMarkup(
      <CodeBlock
        code={"a: 1\nb: 2\n"}
        label="Rule YAML"
        lineNumbers
        activeLine={2}
      />,
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Rule YAML"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("data-numbers");
    expect(html.match(/class="ui-code-line"/g)).toHaveLength(2);
    expect(html).toContain('aria-current="location"');
  });

  test("wraps on request", () => {
    expect(
      renderToStaticMarkup(<CodeBlock code="x" label="x" wrap />),
    ).toContain("data-wrap");
  });
});

describe("CopyButton", () => {
  test("icon variant is a named button with a polite live region", () => {
    const html = renderToStaticMarkup(
      <CopyButton text="abc" label="Copy trace id" />,
    );
    expect(html).toContain('aria-label="Copy trace id"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  test("text variant shows its label", () => {
    expect(
      renderToStaticMarkup(<CopyButton text="abc" variant="text" />),
    ).toContain(">Copy</button>");
  });
});

describe("Pager and the capped list", () => {
  test("a small overflow is shown outright", () => {
    expect(cappedCount(12, 10)).toBe(12);
    expect(cappedCount(13, 10)).toBe(10);
  });

  test("ListToggle says how many there are, or renders nothing", () => {
    const list: Capped<number> = {
      shown: [1, 2],
      hidden: 8,
      capped: true,
      expanded: false,
      toggle: noop,
    };
    const html = renderToStaticMarkup(
      <ListToggle list={list} controls="rows" noun="alerts" />,
    );
    expect(html).toContain("Show all 10 alerts");
    expect(html).toContain('aria-controls="rows"');
    expect(
      renderToStaticMarkup(
        <ListToggle list={{ ...list, capped: false }} controls="rows" />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <ListToggle list={{ ...list, expanded: true }} controls="rows" />,
      ),
    ).toContain("Show fewer");
  });

  test("Pager links the directions it has and greys the rest", () => {
    const html = renderToStaticMarkup(
      <Pager label="Alert pages" olderHref="?before=9" />,
    );
    expect(html).toContain('<nav class="ui-pager" aria-label="Alert pages">');
    expect(html).toContain(
      '<span class="ui-btn" aria-disabled="true" data-disabled="">Newest</span>',
    );
    expect(html).toContain('<a href="?before=9" class="ui-btn">Older</a>');
  });

  test("BackLink names its destination for screen readers", () => {
    const html = renderToStaticMarkup(
      <BackLink href="/alerts" label="Alerts" />,
    );
    expect(html).toContain('href="/alerts"');
    expect(html).toContain('<span class="ui-sr-only">Back to </span>Alerts');
  });
});

describe("form pieces", () => {
  test("Checkbox, Switch and RadioGroup render Base UI roles inside a label", () => {
    const checkbox = renderToStaticMarkup(
      <Checkbox label="Notify me" hint="By email" />,
    );
    expect(checkbox).toContain('<label class="ui-choice">');
    expect(checkbox).toContain('role="checkbox"');
    expect(checkbox).toContain("By email");
    expect(renderToStaticMarkup(<Switch label="Enabled" />)).toContain(
      'role="switch"',
    );
    const radios = renderToStaticMarkup(
      <RadioGroup
        label="Severity"
        options={[
          { value: "warn", label: "Warning" },
          { value: "page", label: "Page me" },
        ]}
      />,
    );
    expect(radios).toContain('role="radiogroup"');
    expect(radios.match(/role="radio"/g)).toHaveLength(2);
  });

  test("Fieldset has a legend, a hint and a linked error", () => {
    const html = renderToStaticMarkup(
      <Fieldset legend="Delivery" hint="Pick one" error="Required">
        x
      </Fieldset>,
    );
    expect(html).toContain(
      '<legend class="ui-fieldset-legend">Delivery</legend>',
    );
    expect(html).toMatch(/aria-describedby="[^"]+-hint [^"]+-error"/);
    expect(html).toContain('aria-invalid="true"');
  });

  test("Textarea and InputAddon use the field look", () => {
    expect(renderToStaticMarkup(<Textarea />)).toContain(
      'class="ui-field-control"',
    );
    const html = renderToStaticMarkup(<InputAddon prefix="go/" aria-invalid />);
    expect(html).toContain("go/");
    expect(html).toContain("data-invalid");
    expect(html).toContain("ui-addon-input");
  });

  test("FormActions swaps the submit label while pending", () => {
    expect(renderToStaticMarkup(<FormActions submit="Save link" />)).toContain(
      ">Save link</button>",
    );
    const pending = renderToStaticMarkup(
      <FormActions submit="Save link" pending />,
    );
    expect(pending).toContain(">Saving…</button>");
    expect(pending).toContain("disabled");
    expect(pending).toContain('aria-busy="true"');
  });

  test("ErrorSummary is a focusable alert that links each field", () => {
    const html = renderToStaticMarkup(
      <ErrorSummary
        errors={[{ fieldId: "f1", label: "Slug", message: "Too short" }]}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("1 problem to fix");
    expect(html).toContain('<a href="#f1">Slug</a>');
    expect(renderToStaticMarkup(<ErrorSummary errors={[]} />)).toBe("");
  });

  test("bind helpers read Zod issues from TanStack Form meta", () => {
    expect(
      fieldErrorMessage({
        errors: [{ message: "Too short" }],
        isTouched: true,
      }),
    ).toBe("Too short");
    expect(
      fieldErrorMessage({
        errors: [{ message: "Too short" }],
        isTouched: false,
      }),
    ).toBeUndefined();
    expect(fieldErrorMessage({ errors: [], isTouched: true })).toBeUndefined();
    expect(
      collectErrorSummary(
        {
          slug: { errors: ["Required"], isTouched: true },
          url: { errors: [], isTouched: true },
        },
        {
          slug: { label: "Slug", fieldId: "a" },
          url: { label: "URL", fieldId: "b" },
        },
      ),
    ).toEqual([{ label: "Slug", fieldId: "a", message: "Required" }]);
  });
});

describe("time pieces", () => {
  test("RelativeTime puts the exact Pacific time in title and the ISO in dateTime", () => {
    const html = renderToStaticMarkup(
      <RelativeTime value="2026-11-26T21:59:09Z" now={NOW} />,
    );
    expect(html).toContain('dateTime="2026-11-26T21:59:09Z"');
    expect(html).toContain('title="Nov 26, 2026, 13:59:09 PT"');
    expect(html).toContain(">3m ago<");
  });

  test("ExactTime prints Pacific time", () => {
    expect(renderToStaticMarkup(<ExactTime value={NOW} />)).toContain(
      ">Nov 26, 14:02 PT<",
    );
  });

  test("Duration takes milliseconds or a start and end", () => {
    expect(renderToStaticMarkup(<Duration ms={8_040_000} />)).toContain(
      'dateTime="PT2H14M"',
    );
    expect(
      renderToStaticMarkup(<Duration start="2026-11-26T19:48:09Z" end={NOW} />),
    ).toContain(">2h 14m<");
    expect(
      renderToStaticMarkup(<Duration start="2026-11-26T21:00:09Z" now={NOW} />),
    ).toContain(">1h 2m<");
  });
});

describe("feedback pieces", () => {
  test("Kbd, StatusDot and SavedStatus", () => {
    expect(renderToStaticMarkup(<Kbd>/</Kbd>)).toBe(
      '<kbd class="ui-kbd">/</kbd>',
    );
    const dot = renderToStaticMarkup(<StatusDot state="reconnecting" />);
    expect(dot).toContain('data-state="reconnecting"');
    expect(dot).toContain("Reconnecting");
    expect(renderToStaticMarkup(<SavedStatus saved />)).toContain(
      'aria-live="polite" data-visible="">Saved.',
    );
    expect(renderToStaticMarkup(<SavedStatus saved={false} />)).not.toContain(
      "Saved.",
    );
  });

  test("Skeleton bones are hidden from assistive tech", () => {
    const rows = renderToStaticMarkup(
      <Skeleton kind="rows" rows={2} columns={3} />,
    );
    expect(rows).toContain('aria-hidden="true"');
    expect(rows.match(/ui-skeleton-row/g)).toHaveLength(2);
    expect(rows.match(/class="ui-bone"/g)).toHaveLength(6);
    expect(
      renderToStaticMarkup(<Skeleton kind="line" lines={3} />).match(
        /ui-bone/g,
      ),
    ).toHaveLength(3);
  });

  test("EmailPreview renders a fully sandboxed frame", () => {
    const html = renderToStaticMarkup(
      <EmailPreview html="<p>Hi</p>" text="Hi" />,
    );
    expect(html).toContain('sandbox=""');
    expect(html).toContain(
      'srcDoc="&lt;p&gt;Hi&lt;/p&gt;"'.replace("srcDoc", "srcDoc"),
    );
    expect(html).toContain("Plain text");
    expect(
      renderToStaticMarkup(<EmailPreview html="<p>Hi</p>" />),
    ).not.toContain("Plain text");
  });
});
