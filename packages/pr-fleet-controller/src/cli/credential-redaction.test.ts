import { describe, expect, it } from "vitest";
import { configuredSecretValues } from "./credential-redaction.ts";

describe("configuredSecretValues", () => {
  it("includes the Gemini key used by the provider contract", () => {
    expect(
      configuredSecretValues({ GEMINI_API_KEY: "gemini-secret" }),
    ).toContain("gemini-secret");
  });
});
