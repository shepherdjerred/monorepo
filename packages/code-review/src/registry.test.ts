import { describe, expect, test } from "bun:test";
import { DEFAULT_PROVIDER_ID, resolveProvider } from "./providers/registry.ts";

describe("resolveProvider", () => {
  test("defaults provider-neutral consumers to Codex", () => {
    expect(DEFAULT_PROVIDER_ID).toBe("codex");
    expect(resolveProvider().id).toBe("codex");
    expect(resolveProvider(null).id).toBe("codex");
    expect(resolveProvider("").id).toBe("codex");
    expect(resolveProvider("  ").id).toBe("codex");
  });

  test("resolves every registered provider (case-insensitive, trimmed)", () => {
    expect(resolveProvider("codex").id).toBe("codex");
    expect(resolveProvider("  GREPTILE ").id).toBe("greptile");
    expect(resolveProvider("qodo").id).toBe("qodo");
    expect(resolveProvider("  QODO ").id).toBe("qodo");
  });

  test("rejects unknown providers", () => {
    expect(() => resolveProvider("unknown")).toThrow(/Unknown review provider/);
  });
});
