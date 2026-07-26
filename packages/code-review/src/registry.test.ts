import { describe, expect, test } from "bun:test";
import { DEFAULT_PROVIDER_ID, resolveProvider } from "./providers/registry.ts";

describe("resolveProvider", () => {
  test("defaults to Codex", () => {
    expect(DEFAULT_PROVIDER_ID).toBe("codex");
    expect(resolveProvider().id).toBe("codex");
    expect(resolveProvider(null).id).toBe("codex");
    expect(resolveProvider("").id).toBe("codex");
    expect(resolveProvider("  ").id).toBe("codex");
  });

  test("resolves greptile (case-insensitive, trimmed)", () => {
    expect(resolveProvider("greptile").id).toBe("greptile");
    expect(resolveProvider("  GREPTILE ").id).toBe("greptile");
  });

  test("throws loudly on an unknown provider", () => {
    expect(() => resolveProvider("coderabbit")).toThrow(
      /Unknown review provider/,
    );
  });
});
