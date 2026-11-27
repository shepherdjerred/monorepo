import { describe, expect, test } from "vitest";
import { resolveDotnetExecutable, resolveMise } from "./mise.ts";

const localAppData = String.raw`C:\Users\Developer\AppData\Local`;
const wingetLink = String.raw`C:\Users\Developer\AppData\Local\Microsoft\WinGet\Links\mise.exe`;
const wingetRealExe = [
  localAppData,
  "Microsoft",
  "WinGet",
  "Packages",
  "jdx.mise_winget_source",
  "mise",
  "bin",
  "mise.exe",
].join("\\");
const programFilesExe = String.raw`C:\Program Files\mise\bin\mise.exe`;
const repoRoot = String.raw`C:\repo`;

describe("Windows elevated SSH mise and dotnet resolution", () => {
  test("falls back past WinGet Links symlink failing with os error 448 to real WinGet package binary", async () => {
    const resolved = await resolveMise({
      platform: "win32",
      env: { LOCALAPPDATA: localAppData },
      which: () => wingetLink,
      scanWinGetMisePackages: () => [wingetRealExe],
      spawnProbe: (command) => {
        if (command[0] === wingetLink) {
          throw new Error(
            "Failed to spawn process: The file cannot be accessed by the system. (os error 448)",
          );
        }
        return command[0] === wingetRealExe && command[1] === "--version"
          ? { exitCode: 0, stdout: "2026.10.0 windows-x64\r\n" }
          : { exitCode: 1, stdout: "" };
      },
    });

    expect(resolved).toBe(wingetRealExe);
  });

  test("falls back to ProgramFiles mise.exe when WinGet Links and localAppData shims fail", async () => {
    const resolved = await resolveMise({
      platform: "win32",
      env: {
        LOCALAPPDATA: localAppData,
        ProgramFiles: String.raw`C:\Program Files`,
      },
      which: () => null,
      scanWinGetMisePackages: () => [],
      spawnProbe: (command) => {
        if (command[0] === programFilesExe) {
          return { exitCode: 0, stdout: "2026.10.0\r\n" };
        }
        throw new Error("os error 448: untrusted mount point");
      },
    });

    expect(resolved).toBe(programFilesExe);
  });

  test("throws a clear error when every mise candidate is missing or blocked", async () => {
    await expect(
      resolveMise({
        platform: "win32",
        env: { LOCALAPPDATA: localAppData },
        which: () => null,
        scanWinGetMisePackages: () => [],
        spawnProbe: () => {
          throw new Error("os error 448");
        },
      }),
    ).rejects.toThrow(/mise is missing or unusable/u);
  });

  test("resolveDotnetExecutable uses mise where dotnet when runnable", async () => {
    const dotnetDir = String.raw`C:\Users\Developer\AppData\Local\mise\installs\dotnet\10.0.404`;
    const dotnetExe = String.raw`${dotnetDir}\dotnet.exe`;
    const resolved = await resolveDotnetExecutable(repoRoot, {
      platform: "win32",
      env: { LOCALAPPDATA: localAppData },
      which: () => null,
      scanWinGetMisePackages: () => [wingetRealExe],
      spawnProbe: (command) => {
        if (command[0] === wingetRealExe && command[1] === "--version") {
          return { exitCode: 0, stdout: "2026.10.0" };
        }
        if (
          command[0] === wingetRealExe &&
          command[1] === "where" &&
          command[2] === "dotnet"
        ) {
          return { exitCode: 0, stdout: `${dotnetDir}\r\n` };
        }
        return command[0] === dotnetExe && command[1] === "--version"
          ? { exitCode: 0, stdout: "10.0.404\r\n" }
          : { exitCode: 1, stdout: "" };
      },
      readTextFile: async () => '[tools]\ndotnet = "10.0.404"\n',
    });

    expect(resolved).toBe(dotnetExe);
  });

  test("resolveDotnetExecutable bypasses broken junctions by reading .mise.toml install path directly", async () => {
    const junctionDir = String.raw`C:\Users\Developer\AppData\Local\mise\installs\dotnet\latest`;
    const junctionExe = String.raw`${junctionDir}\dotnet.exe`;
    const directExe = String.raw`C:\Users\Developer\AppData\Local\mise\installs\dotnet\10.0.404\dotnet.exe`;

    const resolved = await resolveDotnetExecutable(repoRoot, {
      platform: "win32",
      env: { LOCALAPPDATA: localAppData },
      which: () => wingetLink,
      scanWinGetMisePackages: () => [wingetRealExe],
      spawnProbe: (command) => {
        if (command[0] === wingetLink || command[0] === junctionExe) {
          throw new Error("os error 448: untrusted mount point");
        }
        if (command[0] === wingetRealExe && command[1] === "--version") {
          return { exitCode: 0, stdout: "2026.10.0" };
        }
        if (command[0] === wingetRealExe && command[1] === "where") {
          return { exitCode: 0, stdout: `${junctionDir}\r\n` };
        }
        return command[0] === directExe && command[1] === "--version"
          ? { exitCode: 0, stdout: "10.0.404\r\n" }
          : { exitCode: 1, stdout: "" };
      },
      readTextFile: async () => '[tools]\ndotnet = "10.0.404"\n',
    });

    expect(resolved).toBe(directExe);
  });
});
