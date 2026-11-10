import { describe, expect, test } from "vitest";
import { projectedReader } from "./projected-reader.ts";
import { KubernetesUnavailableError } from "./projected-identity.ts";

const reader = { name: "application", directory: "/unused" };

function failing(error: Error) {
  return projectedReader(reader, () => Promise.reject(error));
}

describe("a projected read that fails", () => {
  test.each([
    [
      "a refused connection",
      Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
    ],
    [
      "a reset connection",
      Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    ],
    ["a timeout", new KubernetesUnavailableError("timed out")],
    ["an HTTP 503", new KubernetesUnavailableError("HTTP 503")],
  ])("is UNAVAILABLE, and retryable, for %s", async (_case, error) => {
    await expect(failing(error)("/api")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  test.each([
    [
      "a missing projected token",
      Object.assign(new Error("open"), { code: "ENOENT" }),
    ],
    [
      "a refused identity",
      new Error("Kubernetes identity read answered HTTP 403"),
    ],
  ])("pauses settlement for %s", async (_case, error) => {
    await expect(failing(error)("/api")).rejects.toMatchObject({
      code: "PAUSED",
    });
  });

  test("passes an absent object through as null", async () => {
    expect(await projectedReader(reader, async () => null)("/api")).toBeNull();
  });
});
