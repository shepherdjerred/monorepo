import { describe, expect, test } from "bun:test";
import { DEFAULT_PROVIDER_ID, resolveProvider } from "./providers/registry.ts";

describe("resolveProvider", () => {
  test("defaults to the required Qodo provider", () => {
    expect(DEFAULT_PROVIDER_ID).toBe("qodo");
    expect(resolveProvider().id).toBe("qodo");
    expect(resolveProvider(null).id).toBe("qodo");
    expect(resolveProvider("").id).toBe("qodo");
    expect(resolveProvider("  ").id).toBe("qodo");
  });

  test("resolves Qodo (case-insensitive, trimmed)", () => {
    expect(resolveProvider("qodo").id).toBe("qodo");
    expect(resolveProvider("  QODO ").id).toBe("qodo");
  });

  test("rejects retired providers", () => {
    expect(() => resolveProvider("codex")).toThrow(/Unknown review provider/);
    expect(() => resolveProvider("greptile")).toThrow(
      /Unknown review provider/,
    );
  });
});
