import { getConfig } from "./index.js";

describe("config", () => {
  it("should not load the default configuration", () => {
    expect(() => getConfig("../../config.example.toml")).toThrow();
  });
});
