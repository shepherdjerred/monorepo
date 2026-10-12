import { describe, expect, it } from "vitest";
import { getConfig } from "./index.ts";

describe("config", () => {
  it("should not load the default configuration", async () => {
    await expect(getConfig("../../config.example.toml")).rejects.toThrow();
  });
});
