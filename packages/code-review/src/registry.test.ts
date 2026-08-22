import { describe, expect, test } from "vitest";
import {
  DEFAULT_PROVIDER_ID,
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
    expect(resolveProvider("codex").id).toBe("codex");
    expect(resolveProvider("  GREPTILE ").id).toBe("greptile");
    expect(resolveProvider("qodo").id).toBe("qodo");
    expect(resolveProvider("  QODO ").id).toBe("qodo");
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
