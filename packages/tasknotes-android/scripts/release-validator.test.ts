import { expect, test } from "vitest";
import { mkdtemp, rm, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("Java release validator rejects malformed identity, unsafe native libraries, unsigned signatures and changed payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "facet-release-check-"));
  async function run(command: string[]): Promise<void> {
    const child = Bun.spawn(command, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(await child.exited, stdout + stderr).toBe(0);
  }
  try {
    const sdk = process.env["ANDROID_HOME"];
    if (!sdk)
      throw new Error(
        "ANDROID_HOME must identify the installed Android SDK for release validator tests.",
      );
    const ndk = join(sdk, "ndk/28.2.13676358");
    const properties = await readFile(join(ndk, "source.properties"), "utf8");
    if (!/^Pkg\.Revision\s*=\s*28\.2\.13676358\s*$/m.test(properties))
      throw new Error(
        "Release validator tests require the pinned Android NDK.",
      );
    const host =
      process.platform === "darwin"
        ? "darwin-x86_64"
        : process.platform === "linux"
          ? "linux-x86_64"
          : process.platform === "win32"
            ? "windows-x86_64"
            : undefined;
    if (!host)
      throw new Error("The release test host has no supported NDK toolchain.");
    const tools = join(ndk, "toolchains/llvm/prebuilt", host, "bin");
    const strip = resolve(
      tools,
      "llvm-strip" + (process.platform === "win32" ? ".exe" : ""),
    );
    await realpath(strip);
    await run([strip, "--version"]);
    const fixture = join(root, "fixture.c");
    await writeFile(fixture, "int facet_fixture_value(void) { return 42; }\n");
    const arm = join(root, "arm64-fixture.so"),
      x86 = join(root, "x86-fixture.so");
    const compilerSuffix = process.platform === "win32" ? ".cmd" : "";
    for (const [compiler, output] of [
      ["aarch64-linux-android29-clang", arm],
      ["x86_64-linux-android29-clang", x86],
    ]) {
      if (!compiler || !output)
        throw new Error("The native test fixture compiler is missing.");
      await run([
        join(tools, compiler + compilerSuffix),
        "-shared",
        "-fPIC",
        "-g",
        "-Wl,-z,max-page-size=16384",
        fixture,
        "-o",
        output,
      ]);
    }
    await run([
      "javac",
      "-Xlint:all",
      "-Werror",
      "-d",
      root,
      join(import.meta.dirname, "ValidateSignedBundle.java"),
      join(import.meta.dirname, "ReleaseValidatorChecks.java"),
    ]);
    await run([
      "java",
      "-cp",
      root,
      "ReleaseValidatorChecks",
      root,
      strip,
      arm,
      x86,
    ]);
  } finally {
    await rm(root, { recursive: true });
  }
}, 20_000);
