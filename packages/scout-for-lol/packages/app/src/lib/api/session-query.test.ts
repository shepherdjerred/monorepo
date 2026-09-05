import { describe, expect, test } from "vitest";
import {
  resolveSessionGuardState,
  SESSION_QUERY_OPTIONS,
} from "#src/lib/api/session-query.ts";

describe("session query", () => {
  test("only a successful anonymous response means signed out", () => {
    expect(resolveSessionGuardState({ user: null }, false)).toBe("anonymous");
    expect(resolveSessionGuardState(undefined, true)).toBe("unavailable");
  });

  test("keeps cached authentication through a failed background refresh", () => {
    expect(resolveSessionGuardState({ user: { discordId: "123" } }, true)).toBe(
      "authenticated",
    );
  });

  test("polls after retries are exhausted so a restarted backend can recover", () => {
    expect(
      SESSION_QUERY_OPTIONS.refetchInterval({ state: { status: "error" } }),
    ).toBe(2000);
    expect(
      SESSION_QUERY_OPTIONS.refetchInterval({ state: { status: "success" } }),
    ).toBe(false);
  });
});
