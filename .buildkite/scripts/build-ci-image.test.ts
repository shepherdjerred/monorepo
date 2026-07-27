import { expect, test } from "bun:test";
import {
  builderCreateCommand,
  ciImageBuildCommand,
  ciImageTags,
} from "./migration-core.ts";

test("tags the immutable commit and latest", () => {
  expect(ciImageTags("ghcr.io/shepherdjerred/ci-playwright", "abc")).toEqual([
    "--tag",
    "ghcr.io/shepherdjerred/ci-playwright:abc",
    "--tag",
    "ghcr.io/shepherdjerred/ci-playwright:latest",
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
  );
  expect(command).toContain("ci");
  expect(command).toContain(".buildkite/ci-playwright/Dockerfile");
  expect(command).toContain(
    "type=registry,ref=ghcr.io/shepherdjerred/ci-playwright:buildcache",
  );
  expect(command).toContain("--push");
});
