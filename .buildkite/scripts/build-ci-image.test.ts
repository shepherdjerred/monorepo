import { expect, test } from "bun:test";
import {
  builderCreateCommand,
  builtImageDigest,
  ciImageBuildCommand,
  ciImageDefinition,
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
    "ghcr.io/shepherdjerred/ci-playwright",
    ".buildkite/ci-playwright/Dockerfile",
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
