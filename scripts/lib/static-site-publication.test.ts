import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  publishStaticSiteArchive,
  staticArchiveUri,
  staticSiteComponent,
} from "./static-site-publication.ts";

const uploads = vi.hoisted(() => {
  const published: { uri: string; digest: string }[] = [];
  return published;
});
vi.mock("./artifacts/immutable-archive.ts", () => ({
  publishImmutableArchive: (input: { uri: string; digest: string }) => {
    uploads.push({ uri: input.uri, digest: input.digest });
    return Promise.resolve();
  },
}));

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "static-site-publication-"));
  uploads.length = 0;
  vi.stubEnv("CI_REPO_ID", "1");
  vi.stubEnv("CI_PIPELINE_NUMBER", "42");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true });
});

async function publish(registry: "v1" | "v2") {
  const source = path.join(scratch, "dist");
  await Bun.write(path.join(source, "index.html"), "<p>site</p>\n");
  const metadataDirectory = path.join(scratch, "metadata");
  await publishStaticSiteArchive({
    bucket: "sjer-red",
    source,
    metadataDirectory,
    registry,
  });
  const metadata: unknown = await Bun.file(
    path.join(metadataDirectory, "sjer-red.json"),
  ).json();
  return metadata;
}

describe("static site archive publication under the catalog flag", () => {
  test("with the flag off, registers the v1 `site:` component", async () => {
    const metadata = await publish("v1");
    const [upload] = uploads;
    expect(upload).toBeDefined();
    expect(metadata).toMatchObject({
      id: "ci/1/42/site/sjer-red",
      component: "site:sjer-red",
      kind: "archive",
      uri: upload?.uri,
      digest: upload?.digest,
      version: "build-42",
    });
  });

  test("with the flag on, registers the v2 `archive:` component the site recipes request", async () => {
    const metadata = await publish("v2");
    const [upload] = uploads;
    expect(metadata).toMatchObject({
      component: "archive:sjer-red",
      kind: "archive",
      uri: staticArchiveUri("sjer-red", upload?.digest ?? ""),
    });
  });

  test("names components only for valid buckets", () => {
    expect(staticSiteComponent("scout-frontend", "v1")).toBe(
      "site:scout-frontend",
    );
    expect(staticSiteComponent("scout-frontend", "v2")).toBe(
      "archive:scout-frontend",
    );
    expect(() => staticSiteComponent("Not A Bucket", "v2")).toThrow(
      "Invalid static archive identity",
    );
  });
});
