import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { OperationsBlockedReason } from "#src/components/operations/operations-blocked-reason.tsx";

/**
 * The point of this component is that the two reasons do NOT look alike. A
 * contract violation buried in the same grey as "this intent has settled"
 * would hide an incident inside a table cell.
 */
describe("OperationsBlockedReason", () => {
  test("an ordinary domain rule reads as quiet detail", () => {
    const markup = renderToStaticMarkup(
      <OperationsBlockedReason
        blocked={{ tone: "rule", message: "This intent has settled." }}
      />,
    );
    expect(markup).toContain('data-blocked-tone="rule"');
    expect(markup).toContain("text-scout-subtle");
    expect(markup).not.toContain("text-scout-danger");
    expect(markup).not.toContain('role="alert"');
  });

  test("a contract violation is styled as an error and announced", () => {
    const markup = renderToStaticMarkup(
      <OperationsBlockedReason
        blocked={{
          tone: "contract-violation",
          message:
            "Unrecognised state: brand-new. This is a contract violation — report it.",
        }}
      />,
    );
    expect(markup).toContain('data-blocked-tone="contract-violation"');
    expect(markup).toContain("text-scout-danger");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("text-scout-subtle");
    expect(markup).toContain("report it");
  });
});
