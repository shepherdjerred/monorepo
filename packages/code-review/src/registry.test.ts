import { describe, expect, test } from "vitest";
import {
  DEFAULT_PROVIDER_ID,
  PROVIDERS,
  ProviderIdSchema,
  REQUIRED_REVIEW_PROVIDER_ID,
  resolveProvider,
  resolveRequiredReviewProvider,
} from "./providers/registry.ts";

describe("resolveProvider", () => {
  test("defaults provider-neutral consumers to Codex", () => {
    expect(DEFAULT_PROVIDER_ID).toBe("codex");
    expect(resolveProvider().id).toBe("codex");
    expect(resolveProvider(null).id).toBe("codex");
    expect(resolveProvider("").id).toBe("codex");
    expect(resolveProvider("  ").id).toBe("codex");
  });

  test("resolves every registered provider (case-insensitive, trimmed)", () => {
    expect(ProviderIdSchema.options).toEqual([
      "codex",
      "greptile",
      "qodo",
      "coderabbit",
      "cubic",
      "codeant",
    ]);
    expect(Object.keys(PROVIDERS)).toEqual(ProviderIdSchema.options);
    expect(resolveProvider("codex").id).toBe("codex");
    expect(resolveProvider("  GREPTILE ").id).toBe("greptile");
    expect(resolveProvider("qodo").id).toBe("qodo");
    expect(resolveProvider("  QODO ").id).toBe("qodo");
    expect(resolveProvider("coderabbit").id).toBe("coderabbit");
    expect(resolveProvider("cubic").id).toBe("cubic");
    expect(resolveProvider("  CUBIC ").id).toBe("cubic");
    expect(resolveProvider("codeant").id).toBe("codeant");
    expect(resolveProvider("  CodeAnt ").id).toBe("codeant");
  });

  test("uses Codex as the required CI provider", () => {
    expect(REQUIRED_REVIEW_PROVIDER_ID).toBe("codex");
    expect(resolveRequiredReviewProvider().id).toBe("codex");
    expect(resolveProvider().id).toBe("codex");
  });

  test("rejects unknown providers", () => {
    expect(() => resolveProvider("unknown")).toThrow(/Unknown review provider/);
  });
});
