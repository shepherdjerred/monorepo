import { describe, expect, test } from "vitest";
import { buildCommands, buildToolkit } from "#build";

describe("toolkit build", () => {
  test("signs the compiled artifact on macOS", () => {
    expect(buildCommands("darwin")).toEqual([
      [
        "bun",
        "build",
        "./src/index.ts",
        "--compile",
        "--external",
        "ffmpeg-static",
        "--outfile=dist/toolkit",
      ],
      ["codesign", "--force", "--sign", "-", "dist/toolkit"],
    ]);
  });

  test("does not add macOS signing to Linux builds", () => {
    expect(buildCommands("linux")).toHaveLength(1);
  });

  test("runs signing only after compilation succeeds", async () => {
    const commands: string[][] = [];
    const run = async (command: readonly string[]) => {
      commands.push([...command]);
    };

    await buildToolkit("/toolkit", "darwin", run);

    expect(commands).toHaveLength(2);
    expect(commands[1]?.[0]).toBe("codesign");
  });

  test("does not sign when compilation fails", async () => {
    const commands: string[][] = [];
    const run = async (command: readonly string[]) => {
      commands.push([...command]);
      throw new Error("compile failed");
    };

    await expect(buildToolkit("/toolkit", "darwin", run)).rejects.toThrow(
      "compile failed",
    );
    expect(commands).toHaveLength(1);
  });
});
