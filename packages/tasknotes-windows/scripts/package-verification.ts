import path from "node:path";
import { createHash } from "node:crypto";

type CaptureCommand = (command: [string, ...string[]]) => string;

export function createPackageVerifier(
  packageRoot: string,
  capture: CaptureCommand,
  captureDeveloper: CaptureCommand,
): {
  verifyPackagedNative: (
    appxDirectory: string,
    expectedIdentity: string,
  ) => Promise<void>;
  verifyPackagedLicense: (archivePath: string) => Promise<void>;
} {
  async function verifyPackagedNative(
    appxDirectory: string,
    expectedIdentity: string,
  ): Promise<void> {
    const packages = [
      ...new Bun.Glob("**/*.msix").scanSync({
        cwd: appxDirectory,
        onlyFiles: true,
      }),
    ];
    if (packages.length === 0) {
      throw new Error(`No MSIX was produced under ${appxDirectory}`);
    }

    const newest = packages
      .map((relativePath) => ({
        relativePath,
        lastModified: Bun.file(path.join(appxDirectory, relativePath))
          .lastModified,
      }))
      .sort((left, right) => right.lastModified - left.lastModified)[0];
    if (newest === undefined) {
      throw new Error(`No MSIX was produced under ${appxDirectory}`);
    }

    const archivePath = path.join(appxDirectory, newest.relativePath);
    await verifyPackagedLicense(archivePath);
    captureDeveloper(["signtool.exe", "verify", "/pa", "/all", archivePath]);
    const entries = capture(["tar.exe", "-tf", archivePath])
      .split(/\r?\n/u)
      .map((entry) => entry.replaceAll("\\", "/"));
    if (
      !entries.some(
        (entry) =>
          entry.endsWith("/tasknotes_core_ffi.dll") ||
          entry === "tasknotes_core_ffi.dll",
      )
    ) {
      throw new Error(
        `Packaged application is missing tasknotes_core_ffi.dll: ${archivePath}`,
      );
    }

    const manifest = capture([
      "tar.exe",
      "-xOf",
      archivePath,
      "AppxManifest.xml",
    ]);
    const escapedIdentity = expectedIdentity.replaceAll(".", String.raw`\.`);
    if (
      !new RegExp(String.raw`\bName=["']${escapedIdentity}["']`, "u").test(
        manifest,
      )
    ) {
      throw new Error(
        `Packaged application identity is not '${expectedIdentity}': ${archivePath}`,
      );
    }
    if (!entries.includes("AppxSignature.p7x")) {
      throw new Error(`Packaged application has no signature: ${archivePath}`);
    }
  }

  async function verifyPackagedLicense(archivePath: string): Promise<void> {
    const result = Bun.spawnSync(
      ["tar.exe", "-xOf", archivePath, "Licenses/GPL-3.0.txt"],
      { stdout: "pipe", stderr: "inherit" },
    );
    const expected = await Bun.file(
      path.resolve(packageRoot, "..", "..", "LICENSE"),
    ).arrayBuffer();
    if (
      result.exitCode !== 0 ||
      createHash("sha256").update(result.stdout).digest("hex") !==
        createHash("sha256").update(new Uint8Array(expected)).digest("hex")
    ) {
      throw new Error(
        "The Windows package must contain the exact repository GPL-3.0-only license.",
      );
    }
    for (const [source, bundled] of [
      ["ThirdPartyNotices.txt", "RustThirdPartyNotices.txt"],
      ["native-license-inventory.json", "native-license-inventory.json"],
      ["NuGetThirdPartyNotices.txt", "NuGetThirdPartyNotices.txt"],
      ["nuget-license-inventory.json", "nuget-license-inventory.json"],
    ] as const) {
      const packaged = Bun.spawnSync(
        ["tar.exe", "-xOf", archivePath, `Licenses/${bundled}`],
        { stdout: "pipe", stderr: "inherit" },
      );
      const generated = await Bun.file(
        path.join(packageRoot, "generated/notices", source),
      ).bytes();
      if (
        packaged.exitCode !== 0 ||
        createHash("sha256").update(packaged.stdout).digest("hex") !==
          createHash("sha256").update(generated).digest("hex")
      )
        throw new Error(
          `The Windows package lacks the exact generated ${bundled}.`,
        );
    }
  }

  return { verifyPackagedNative, verifyPackagedLicense };
}
