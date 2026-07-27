import { expect, test } from "bun:test";

import {
  forceMutableUploadCommand,
  isMissingS3Object,
} from "./s3-static-site.ts";

test("forced mutable upload overwrites entrypoints and preserves protected prefixes", () => {
  expect(
    forceMutableUploadCommand({
      source: "/tmp/release",
      dest: "s3://scout-frontend/",
      endpoint: "https://s3.example.test",
      excludes: ["_astro/*", "app/assets/*", ".release-version"],
      dryRun: false,
    }),
  ).toEqual([
    "aws",
    "s3",
    "cp",
    "/tmp/release",
    "s3://scout-frontend/",
    "--recursive",
    "--endpoint-url",
    "https://s3.example.test",
    "--exclude",
    "_astro/*",
    "--exclude",
    "app/assets/*",
    "--exclude",
    ".release-version",
    "--cache-control",
    "no-cache",
  ]);
});

test("forced mutable upload supports an AWS dry run", () => {
  expect(
    forceMutableUploadCommand({
      source: "/tmp/release",
      dest: "s3://scout-frontend/",
      endpoint: "https://s3.example.test",
      excludes: [],
      dryRun: true,
    }).at(-1),
  ).toBe("--dryrun");
});

test("recognizes only missing-object S3 diagnostics as repairable drift", () => {
  expect(
    isMissingS3Object(
      'fatal error: An error occurred (404) when calling the HeadObject operation: Key "app/index.html" does not exist',
    ),
  ).toBe(true);
  expect(
    isMissingS3Object(
      "fatal error: An error occurred (NoSuchKey) when calling the GetObject operation",
    ),
  ).toBe(true);
  expect(isMissingS3Object("fatal error: Access Denied")).toBe(false);
});
