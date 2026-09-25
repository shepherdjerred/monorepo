import { expect, test } from "vitest";
import {
  builderCreateCommand,
  builtImageDigest,
  ciImageBuildCommand,
  ciImageDefinition,
  ciImageSelftestCommand,
  ciImageSourceFingerprint,
  ciImageTags,
} from "./build-ci-image-core.ts";

async function missingSource(): Promise<Uint8Array | undefined> {
  return;
}

test("tags only the content-addressed candidate", () => {
  expect(ciImageTags("ghcr.io/shepherdjerred/ci-playwright", "abc")).toEqual([
    "--tag",
    "ghcr.io/shepherdjerred/ci-playwright:candidate-abc",
  ]);
});

test("uses the remote builder for production pushes", () => {
  expect(builderCreateCommand).toContain(
    "tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234",
  );
  const command = ciImageBuildCommand(
    ciImageDefinition("ci-playwright"),
    "abc",
    "/tmp/metadata.json",
  );
  expect(command).toContain("ci");
  expect(command).toContain(".buildkite/ci-playwright/Dockerfile");
  expect(command).toContain(
    "type=registry,ref=ghcr.io/shepherdjerred/ci-playwright:buildcache",
  );
  expect(command).toContain("/tmp/metadata.json");
  expect(command).toContain("--push");
  expect(command).not.toContain("latest");
  expect(command).not.toContain("--target");
  expect(command).not.toContain("--platform");
});

test("defines CI images independently", () => {
  expect(ciImageDefinition("ci-base").sourceFiles).toEqual([
    ".buildkite/ci-image/Dockerfile",
    ".mise.toml",
  ]);
  expect(ciImageDefinition("ci-playwright").sourceFiles).toEqual([
    ".buildkite/ci-playwright/Dockerfile",
  ]);
  expect(() => ciImageDefinition("unknown")).toThrow("Unknown CI image");
});

test("requires a canonical Buildx image digest", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  expect(builtImageDigest({ "containerimage.digest": digest })).toBe(digest);
  expect(() => builtImageDigest({ "containerimage.digest": "latest" })).toThrow(
    "canonical image digest",
  );
  expect(() => builtImageDigest({})).toThrow("canonical image digest");
});

test("fingerprints only the selected CI image source files", async () => {
  expect(
    await ciImageSourceFingerprint(ciImageDefinition("ci-playwright")),
  ).toMatch(/^[\da-f]{64}$/);
  const requested: string[] = [];
  expect(
    await ciImageSourceFingerprint(
      ciImageDefinition("ci-base"),
      async (path) => {
        requested.push(path);
        return new TextEncoder().encode(`contents:${path}`);
      },
    ),
  ).toMatch(/^[\da-f]{64}$/);
  expect(requested).toEqual([".buildkite/ci-image/Dockerfile", ".mise.toml"]);
  await expect(
    ciImageSourceFingerprint(
      {
        ...ciImageDefinition("ci-playwright"),
        sourceFiles: [".buildkite/ci-playwright/missing"],
      },
      missingSource,
    ),
  ).rejects.toThrow("source file is missing");
});

test("publishes each windows-cross-compiler image from its stage for amd64", () => {
  const base = ciImageDefinition("windows-cross-compiler");
  const winui = ciImageDefinition("windows-cross-compiler-winui");
  expect(base.target).toBe("base");
  expect(winui.target).toBe("winui");
  for (const definition of [base, winui]) {
    expect(definition.platform).toBe("linux/amd64");
    expect(definition.dockerfile).toBe(
      "packages/windows-cross-compiler/Dockerfile",
    );
    expect(definition.digestFile).toBe(
      `packages/windows-cross-compiler/images/${definition.name}/DIGEST`,
    );
    expect(definition.sourceFiles).toContain(
      "packages/windows-cross-compiler/msbuild/WindowsCross.targets",
    );
    expect(definition.sourceFiles).toContain(
      "packages/windows-cross-compiler/wine-patches/0001-shcore-forward-PathIsNetworkPathW.patch",
    );
  }
  expect(ciImageBuildCommand(winui, "abc", "/tmp/metadata.json")).toEqual(
    expect.arrayContaining(["--target", "winui", "--platform", "linux/amd64"]),
  );
  expect(ciImageBuildCommand(base, "abc", "/tmp/metadata.json")).toEqual(
    expect.arrayContaining(["--target", "base", "--platform", "linux/amd64"]),
  );
});

test("self-tests read both image caches without pushing", () => {
  const definitions = [
    ciImageDefinition("windows-cross-compiler"),
    ciImageDefinition("windows-cross-compiler-winui"),
  ];
  const command = ciImageSelftestCommand(
    definitions,
    "selftest-report",
    "windows-cross-compiler-selftest",
  );
  expect(command).toEqual(
    expect.arrayContaining([
      "--target",
      "selftest-report",
      "type=local,dest=windows-cross-compiler-selftest",
      "type=registry,ref=ghcr.io/shepherdjerred/windows-cross-compiler:buildcache",
      "type=registry,ref=ghcr.io/shepherdjerred/windows-cross-compiler-winui:buildcache",
    ]),
  );
  expect(command).not.toContain("--push");
  expect(command.some((argument) => argument.startsWith("--cache-to"))).toBe(
    false,
  );
});

test("self-tests reject images from different Dockerfiles", () => {
  expect(() =>
    ciImageSelftestCommand(
      [
        ciImageDefinition("windows-cross-compiler"),
        ciImageDefinition("ci-base"),
      ],
      "selftest-report",
      "out",
    ),
  ).toThrow("does not share");
  expect(() => ciImageSelftestCommand([], "selftest-report", "out")).toThrow(
    "at least one image definition",
  );
});
