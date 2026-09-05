import { Loaded } from "@shepherdjerred/loaded";
import { describe, expect, test } from "vitest";
import {
  resolveSessionGuardState,
  SESSION_QUERY_OPTIONS,
} from "#src/lib/session-query.ts";

describe("session query", () => {
  test("only a successful anonymous response means signed out", () => {
    expect(resolveSessionGuardState(Loaded.done({ user: null }))).toBe(
      "anonymous",
    );
    expect(
      resolveSessionGuardState(Loaded.failed(new Error("unreachable"))),
    ).toBe("unavailable");
    expect(resolveSessionGuardState(Loaded.loading())).toBe("loading");
  });

  test("keeps cached authentication through a failed background refresh", () => {
    // This is `degraded`: a session in hand and a failed refresh over it. The
    // guard predates the name and already made the right call.
    expect(
      resolveSessionGuardState(
        Loaded.degraded({ user: { discordId: "123" } }, [
          { path: ["auth.sessionState"], error: new Error("refresh failed") },
        ]),
      ),
    ).toBe("authenticated");
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
