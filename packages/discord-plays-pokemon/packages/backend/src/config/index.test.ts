import { describe, expect, it } from "vitest";
import { getConfig } from "./index.ts";

describe("config", () => {
  it("should not load the default configuration", () => {
    expect(() => getConfig("../../config.example.toml")).toThrow();
  });
});
