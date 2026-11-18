import { describe, expect, test } from "vitest";
import { toolchainVersionMatches, toolchainVersions } from "./toolchain.ts";

describe("Windows root-owned toolchain preflight", () => {
  test("a root pin update changes the accepted SDK without another literal", () => {
    const pins = toolchainVersions({
      tools: { dotnet: "12.3.456", bun: "1.0.0" },
    });
    expect(toolchainVersionMatches("dotnet", pins.dotnet, "12.3.456\r\n")).toBe(
      true,
    );
    expect(toolchainVersionMatches("dotnet", pins.dotnet, "12.3.455")).toBe(
      false,
    );
  });

  test("the real root manifest supplies the native preflight SDK version", async () => {
    const rootConfiguration = Bun.TOML.parse(
      await Bun.file(new URL("../../../.mise.toml", import.meta.url)).text(),
    );
    const pins = toolchainVersions(rootConfiguration);
    expect(toolchainVersionMatches("dotnet", pins.dotnet, pins.dotnet)).toBe(
      true,
    );
  });

  test.each([
    {},
    { tools: { bun: "1.0.0" } },
    { tools: { dotnet: "latest" } },
    { tools: { dotnet: { version: "10.0.303" } } },
  ])(
    "rejects missing or unsupported root pins without substituting a version",
    (value) => {
      expect(() => toolchainVersions(value)).toThrow();
    },
  );

  test.each(["", "10.0.3030", "10.0.303-preview.1", "dotnet 10.0.303"])(
    "rejects a missing or different SDK identity %s",
    (output) => {
      expect(toolchainVersionMatches("dotnet", "10.0.303", output)).toBe(false);
    },
  );
});
