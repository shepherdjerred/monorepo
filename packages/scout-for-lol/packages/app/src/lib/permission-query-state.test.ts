import { describe, expect, test } from "bun:test";
import {
  resolvePermissionQueryError,
  shouldQueryScopedPermissions,
} from "#src/lib/permission-query-state.ts";

describe("permission query state", () => {
  test("a list failure enables the scoped fallback", () => {
    expect(
      shouldQueryScopedPermissions({
        guildId: "123",
        listStatus: "error",
        hasListEntry: false,
      }),
    ).toBe(true);
  });

  test("a successful list miss enables the scoped fallback", () => {
    expect(
      shouldQueryScopedPermissions({
        guildId: "123",
        listStatus: "success",
        hasListEntry: false,
      }),
    ).toBe(true);
  });

  test("a pending list does not start the fallback prematurely", () => {
    expect(
      shouldQueryScopedPermissions({
        guildId: "123",
        listStatus: "pending",
        hasListEntry: false,
      }),
    ).toBe(false);
  });

  test("a successful fallback supersedes the list failure", () => {
    expect(
      resolvePermissionQueryError({
        hasListEntry: false,
        fallbackSucceeded: true,
        listError: new Error("list failed"),
        fallbackError: null,
      }),
    ).toBeNull();
  });

  test("a fallback failure is surfaced instead of becoming no access", () => {
    const fallbackError = new Error("scoped query failed");
    expect(
      resolvePermissionQueryError({
        hasListEntry: false,
        fallbackSucceeded: false,
        listError: new Error("list failed"),
        fallbackError,
      }),
    ).toBe(fallbackError);
  });
});
