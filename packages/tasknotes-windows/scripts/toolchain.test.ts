import { describe, expect, test } from "vitest";
import { toolchainVersionMatches, toolchainVersions } from "./toolchain.ts";

describe("Windows root-owned toolchain preflight", () => {
  test("a root pin update changes the accepted SDK and compiler without another literal", () => {
    const pins = toolchainVersions({
      tools: { dotnet: "12.3.456", rust: "1.234.5", bun: "1.0.0" },
    });
    expect(toolchainVersionMatches("dotnet", pins.dotnet, "12.3.456\r\n")).toBe(
      true,
    );
    expect(
      toolchainVersionMatches(
        "rust",
        pins.rust,
        "rustc 1.234.5 (build 2026-10-24)\n",
      ),
    ).toBe(true);
    expect(toolchainVersionMatches("dotnet", pins.dotnet, "12.3.455")).toBe(
      false,
    );
    expect(
      toolchainVersionMatches("rust", pins.rust, "rustc 1.234.4 (build)"),
    ).toBe(false);
  });

  test("the real root manifest supplies both native preflight versions", async () => {
    const rootConfiguration = Bun.TOML.parse(
      await Bun.file(new URL("../../../.mise.toml", import.meta.url)).text(),
    );
    const pins = toolchainVersions(rootConfiguration);
    expect(toolchainVersionMatches("dotnet", pins.dotnet, pins.dotnet)).toBe(
      true,
    );
    expect(
      toolchainVersionMatches("rust", pins.rust, `rustc ${pins.rust} (build)`),
    ).toBe(true);
  });

  test.each([
    {},
    { tools: { rust: "1.99.0" } },
    { tools: { dotnet: "10.0.303" } },
    { tools: { rust: "latest", dotnet: "10.0.303" } },
    { tools: { rust: "1.99.0", dotnet: { version: "10.0.303" } } },
  ])(
    "rejects missing or unsupported root pins without substituting a version",
    (value) => {
      expect(() => toolchainVersions(value)).toThrow();
    },
  );

  test.each([
    "",
    "1.99.0",
    "cargo 1.99.0",
    "rustc 1.99.00 (build)",
    "rustc 1.99.0-nightly (build)",
  ])("rejects a missing or different compiler identity %s", (output) => {
    expect(toolchainVersionMatches("rust", "1.99.0", output)).toBe(false);
  });
});
