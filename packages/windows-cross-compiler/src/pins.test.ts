import { describe, expect, test } from "vitest";
import {
  dockerfileArgs,
  globalJsonSdkVersion,
  misePin,
  readPackageFile,
  readRepositoryFile,
} from "./pins.ts";

describe("pin parsing", () => {
  test("reads ARG defaults and rejects duplicates", () => {
    expect(dockerfileArgs("ARG A=1\nRUN true\nARG B=two\n")).toEqual(
      new Map([
        ["A", "1"],
        ["B", "two"],
      ]),
    );
    expect(() => dockerfileArgs("ARG A=1\nARG A=2\n")).toThrow(
      /more than once/u,
    );
  });

  test("reads mise and global.json pins", () => {
    expect(misePin('node = "24"\nrust = "1.2.3"\n', "rust")).toBe("1.2.3");
    expect(() => misePin('node = "24"\n', "rust")).toThrow(/no rust pin/u);
    expect(globalJsonSdkVersion('{"sdk":{"version":"10.0.1"}}')).toBe("10.0.1");
    expect(() => globalJsonSdkVersion("{}")).toThrow(/no sdk section/u);
  });
});

describe("image pins", async () => {
  const args = dockerfileArgs(await readPackageFile("Dockerfile"));

  test("the Rust toolchain matches the repository's mise pin", async () => {
    const mise = await readRepositoryFile(".mise.toml");
    expect(args.get("RUST_VERSION")).toBe(misePin(mise, "rust"));
  });

  test("the .NET SDK matches global.json and the mise pin", async () => {
    const globalJson = await readRepositoryFile("global.json");
    const mise = await readRepositoryFile(".mise.toml");
    expect(args.get("DOTNET_SDK_VERSION")).toBe(
      globalJsonSdkVersion(globalJson),
    );
    expect(args.get("DOTNET_SDK_VERSION")).toBe(misePin(mise, "dotnet"));
  });

  test("the WineHQ packages are the release the patched DLLs build from", () => {
    const wine = args.get("WINE_VERSION");
    expect(wine).toBeDefined();
    expect(
      args.get("WINEHQ_PACKAGE_VERSION")?.startsWith(`${String(wine)}.0.0~`),
    ).toBe(true);
  });
});
