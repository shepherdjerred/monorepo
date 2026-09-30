import { describe, expect, test } from "vitest";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;

const image =
  "ghcr.io/shepherdjerred/macos-cross-compiler:15.0@sha256:fb61376ae4288abb57ea477ae55e8b9df280c46bb622d9bb50c4755b6ebbf44f";

async function text(path: string): Promise<string> {
  return Bun.file(`${repositoryRoot}/${path}`).text();
}

describe("TaskNotes Apple cross-compile contract", () => {
  test("the pipeline and the script pin the same compiler image", async () => {
    const pipeline = await text(".buildkite/pipeline.yml");
    const script = await text("packages/tasknotes-core/ci/apple-cross.sh");
    const pinned = pipeline.match(
      /ghcr\.io\/shepherdjerred\/macos-cross-compiler:15\.0@sha256:[a-f0-9]+/gu,
    );
    expect(pinned).toEqual([image, image]);
    expect(script).toContain(image);
  });

  test("deployment targets match the xtask slices", async () => {
    const swift = await text("packages/tasknotes-core/xtask/src/swift.rs");
    const script = await text("packages/tasknotes-core/ci/apple-cross.sh");
    expect(swift).toContain('("MACOSX_DEPLOYMENT_TARGET", "15.0")');
    expect(swift).toContain('("IPHONEOS_DEPLOYMENT_TARGET", "18.0")');
    expect(script).toContain('export MACOSX_DEPLOYMENT_TARGET="15.0"');
    expect(script).toContain('export IPHONEOS_DEPLOYMENT_TARGET="18.0"');
  });

  test("the script builds every xtask Apple rust target", async () => {
    const swift = await text("packages/tasknotes-core/xtask/src/swift.rs");
    const script = await text("packages/tasknotes-core/ci/apple-cross.sh");
    const targets = [
      ...swift.matchAll(/"(?:aarch64|x86_64)-apple-[a-z0-9-]+"/gu),
    ].map((match) => match[0].slice(1, -1));
    const unique = [...new Set(targets)].sort();
    expect(unique).toEqual([
      "aarch64-apple-darwin",
      "aarch64-apple-ios",
      "aarch64-apple-ios-sim",
      "x86_64-apple-darwin",
      "x86_64-apple-ios",
    ]);
    for (const target of unique) {
      expect(script).toContain(target);
    }
  });
});
