import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  realpath,
  rm,
  readFile,
  lstat,
  symlink,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createPrivateCaptureDirectory } from "./private.ts";
import { capturePrivateInstalledCorpus } from "./run.ts";
import { PrivateCaptureManifestSchema } from "./contract.ts";
import { installedCaptureFixture } from "./test-fixture.ts";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import { z } from "zod";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const parent = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-private-capture-")),
  );
  directories.push(parent);
  return {
    parent,
    directory: path.join(parent, "capture"),
    worktree: process.cwd(),
  };
}
test("real capture coordinator writes private hashed unlabelled artifacts with original profiles and aggregate-only return", async () => {
  const f = await fixture(),
    wire = installedCaptureFixture();
  const result = await capturePrivateInstalledCorpus({ ...f, ...wire });
  const manifest = PrivateCaptureManifestSchema.parse(
    JSON.parse(
      await readFile(path.join(f.directory, "capture-manifest.json"), "utf8"),
    ),
  );
  const profiles = await readFile(
    path.join(f.directory, manifest.profiles.path),
  );
  expect(JSON.parse(profiles.toString("utf8")).inventories).toEqual(
    snapshot.inventories,
  );
  expect(createHash("sha256").update(profiles).digest("hex")).toBe(
    manifest.profiles.sha256,
  );
  expect(result).toMatchObject({
    stage: "installed-catalog-unlabelled",
    sources: [
      { source: "radarr", catalogRecords: 1, installedFiles: 1 },
      { source: "sonarr", catalogRecords: 3, installedFiles: 1 },
    ],
    observations: {
      releaseCandidates: "not_captured",
      probes: "not_captured",
      independentLabels: "not_authored",
    },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /Paper Lantern|Cloud Harbor|127\.0\.0\.1|synthetic-.*credential/u,
  );
  const directoryStat = await lstat(f.directory);
  expect(directoryStat.mode & 0o777).toBe(0o700);
  for (const name of await readdir(f.directory)) {
    const fileStat = await lstat(path.join(f.directory, name));
    expect(fileStat.mode & 0o777).toBe(0o600);
  }
  await expect(
    capturePrivateInstalledCorpus({ ...f, ...wire }),
  ).rejects.toMatchObject({
    diagnostic: { source: "local", stage: "destination", reason: "io" },
  });
});
test.each([
  "https://private.invalid/key",
  "api_key=secret",
  "synthetic-radarr-credential",
])(
  "refuses forbidden content in an allowlisted value before persisting any body: %s",
  async (title) => {
    const f = await fixture(),
      wire = installedCaptureFixture();
    wire.movie.title = title;
    await expect(
      capturePrivateInstalledCorpus({ ...f, ...wire }),
    ).rejects.toMatchObject({
      diagnostic: {
        source: "radarr",
        stage: "sanitization",
        reason: "forbidden_content",
        artifact: "installed",
        content: {
          path: ["movies", "[]", "title"],
          subreason: title.startsWith("https:")
            ? "url_value"
            : title.startsWith("api_key=")
              ? "credential_pattern"
              : "credential_literal",
        },
      },
    });
    expect(await readdir(f.directory)).toEqual([]);
  },
);
test("private writer refuses in-worktree output, symlink parents, overwrite and escaped names", async () => {
  const f = await fixture();
  await expect(
    createPrivateCaptureDirectory(
      path.join(f.worktree, "private-capture"),
      f.worktree,
    ),
  ).rejects.toThrow("outside the worktree");
  await symlink(f.parent, path.join(f.parent, "link"));
  await expect(
    createPrivateCaptureDirectory(
      path.join(f.parent, "link", "capture"),
      f.worktree,
    ),
  ).rejects.toThrow("real directory");
  const writer = await createPrivateCaptureDirectory(f.directory, f.worktree);
  await writer.write("sample.json", { value: "safe" }, []);
  await expect(
    writer.write("sample.json", { value: "changed" }, []),
  ).rejects.toMatchObject({ code: "EEXIST" });
  await expect(writer.write("../escape.json", {}, [])).rejects.toThrow(
    "artifact name",
  );
  await symlink(
    path.join(f.parent, "absent-target.json"),
    path.join(f.directory, "redirect.json"),
  );
  await expect(writer.write("redirect.json", {}, [])).rejects.toMatchObject({
    code: "EEXIST",
  });
  await expect(
    lstat(path.join(f.parent, "absent-target.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    JSON.parse(await readFile(path.join(f.directory, "sample.json"), "utf8")),
  ).toEqual({ value: "safe" });
});

test("actual capture coordinator identifies Sonarr profile sanitizer refusal before any body write", async () => {
  const f = await fixture(),
    wire = installedCaptureFixture();
  wire.change((url, body) =>
    url.port === "18989" && url.pathname === "/api/v3/customformat"
      ? [
          ...z.array(z.json()).parse(body),
          {
            id: 999_999,
            name: "Synthetic observed format",
            includeCustomFormatWhenRenaming: false,
            specifications: [
              {
                name: "Synthetic observed rule",
                implementation: "ReleaseTitleSpecification",
                negate: false,
                required: true,
                fields: [
                  { name: "value", value: "https://private.invalid/never-log" },
                ],
              },
            ],
          },
        ]
      : body,
  );
  await expect(
    capturePrivateInstalledCorpus({ ...f, ...wire }),
  ).rejects.toMatchObject({
    diagnostic: {
      source: "sonarr",
      stage: "sanitization",
      artifact: "profiles",
      reason: "forbidden_content",
      content: {
        path: [
          "customFormats",
          "[]",
          "specifications",
          "[]",
          "fields",
          "[]",
          "value",
        ],
        subreason: "url_value",
      },
    },
  });
  expect(await readdir(f.directory)).toEqual([]);
});

test("source version changing after installed capture prevents a completed manifest or any data artifact", async () => {
  const f = await fixture(),
    wire = installedCaptureFixture();
  wire.change((url, body) =>
    url.port === "17878" &&
    url.pathname === "/api/v3/system/status" &&
    wire.calls.filter((call) => call === "radarr:/api/v3/movie").length === 2
      ? { version: "changed-build" }
      : body,
  );
  await expect(
    capturePrivateInstalledCorpus({ ...f, ...wire }),
  ).rejects.toMatchObject({
    diagnostic: { source: "radarr", stage: "coherence", reason: "changed" },
  });
  expect(await readdir(f.directory)).toEqual([]);
});
