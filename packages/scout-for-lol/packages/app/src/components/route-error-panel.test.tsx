import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { ErrorPanel, isExpectedRouteError } from "./route-error-panel.tsx";
import { RouteParameterError } from "#src/lib/route-params.ts";

function invalidContractError(): z.ZodError {
  const parsed = z.object({ status: z.literal("ACTIVE") }).safeParse({
    status: "UNKNOWN",
  });
  if (parsed.success) {
    throw new Error("Expected the test fixture to fail Zod validation.");
  }
  return parsed.error;
}

describe("isExpectedRouteError", () => {
  test("suppresses Zod failures explicitly produced by route parameters", () => {
    expect(
      isExpectedRouteError(new RouteParameterError(invalidContractError())),
    ).toBe(true);
  });

  test("reports unrelated Zod contract violations", () => {
    expect(isExpectedRouteError(invalidContractError())).toBe(false);
  });
});

describe("ErrorPanel", () => {
  test("renders title, message, and detail", () => {
    const markup = renderToStaticMarkup(
      <ErrorPanel
        title="This conversation couldn't load"
        message="Couldn't reach Discord, try again in a moment."
        detail="Network timeout"
      />,
    );

    expect(markup).toContain("This conversation couldn&#x27;t load");
    expect(markup).toContain(
      "Couldn&#x27;t reach Discord, try again in a moment.",
    );
    expect(markup).toContain("Network timeout");
    expect(markup).toContain("border-scout-danger/40");
  });

  test("renders retry button and custom action", () => {
    const onRetry = vi.fn();
    const markup = renderToStaticMarkup(
      <ErrorPanel
        title="Explore couldn't load"
        onRetry={onRetry}
        retryLabel="Retry access"
        action={<a href="/explore">New conversation</a>}
      />,
    );

    expect(markup).toContain("Retry access");
    expect(markup).toContain('href="/explore"');
    expect(markup).toContain("New conversation");
  });
});
