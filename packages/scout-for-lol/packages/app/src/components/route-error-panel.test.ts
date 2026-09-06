import { describe, expect, test } from "vitest";
import { z } from "zod";
import { isExpectedRouteError } from "./route-error-panel.tsx";
import { RouteParameterError } from "#src/lib/api/route-params.ts";

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
