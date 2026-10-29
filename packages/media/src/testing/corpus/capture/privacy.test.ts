import { afterEach, expect, test } from "vitest";
import { mkdtemp, realpath, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { installedCaptureFixture } from "./test-fixture.ts";
import { capturePrivateInstalledCorpus } from "./run.ts";
import {
  InstalledCaptureSchema,
  PrivateCaptureManifestSchema,
} from "./contract.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const parent = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-capture-privacy-")),
  );
  directories.push(parent);
  const wire = installedCaptureFixture();
  const episode = wire.episodes[0];
  if (episode === undefined) throw new Error("Synthetic episode missing");
  return {
    ...wire,
    episode,
    directory: path.join(parent, "capture"),
    worktree: process.cwd(),
  };
}
test.each([
  { title: "Password: Swordfish", reason: "credential_pattern" },
  { title: "https://episode.invalid/fictional", reason: "url_value" },
] as const)(
  "optional episode title privacy omission records $reason without changing identities or source rules",
  async ({ title, reason }) => {
    const f = await fixture();
    f.episode.title = title;
    const original = structuredClone(f.episodes);
    const result = await capturePrivateInstalledCorpus(f);
    const manifest = PrivateCaptureManifestSchema.parse(
      JSON.parse(
        await readFile(path.join(f.directory, "capture-manifest.json"), "utf8"),
      ),
    );
    const bytes = await readFile(path.join(f.directory, "installed.json"));
    const captures = z
      .array(InstalledCaptureSchema)
      .parse(JSON.parse(bytes.toString("utf8")));
    const sonarr = captures.find((capture) => capture.source === "sonarr");
    if (sonarr?.source !== "sonarr") throw new Error("Captured series missing");
    expect(manifest.schemaVersion).toBe(2);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      manifest.installed.sha256,
    );
    expect(sonarr.schemaVersion).toBe(2);
    expect(sonarr.privacyOmissions).toEqual([
      {
        source: "sonarr",
        resource: "episode",
        resourceId: 31,
        field: "title",
        reason,
      },
    ]);
    expect(sonarr.episodes).toEqual(
      original.map((episode) => {
        if (episode.id !== 31) return episode;
        const retained = { ...episode };
        delete retained.title;
        return retained;
      }),
    );
    expect(sonarr.episodes[1]).not.toHaveProperty("title");
    expect(
      sonarr.privacyOmissions.some((omission) => omission.resourceId === 32),
    ).toBe(false);
    expect(f.episodes).toEqual(original);
    expect(bytes.toString("utf8")).not.toContain(title);
    expect(result.privacy).toEqual({
      policy: "optional-episode-title-v1",
      omittedOptionalFields: 1,
    });
    expect(result.observations.independentLabels).toBe("not_authored");
    expect(
      result.sources.find((source) => source.source === "sonarr"),
    ).toMatchObject({
      catalogRecords: 3,
      installedFiles: 1,
      privacyOmissions: 1,
    });
    expect(JSON.stringify(result)).not.toContain(title);
  },
);
test.each(["synthetic-radarr-credential", "synthetic-sonarr-credential"])(
  "literal credential in an optional title rejects the entire capture before privacy projection",
  async (literal) => {
    const f = await fixture();
    f.episode.title = "Password: harmless-looking";
    const second = f.episodes[1];
    if (second === undefined) throw new Error("Synthetic episode missing");
    second.title = `Password: ${literal}`;
    await expect(capturePrivateInstalledCorpus(f)).rejects.toMatchObject({
      diagnostic: {
        source: "sonarr",
        stage: "sanitization",
        artifact: "installed",
        reason: "forbidden_content",
        content: {
          path: ["episodes", "[]", "title"],
          subreason: "credential_literal",
        },
      },
    });
    expect(await readdir(f.directory)).toEqual([]);
  },
);
test("two raw passes must agree even when both changing titles would be omitted", async () => {
  const f = await fixture();
  f.episode.title = "Password: first";
  let reads = 0;
  f.change((url, body) =>
    url.pathname === "/api/v3/episode" && ++reads === 2
      ? f.episodes.map((episode) =>
          episode.id === 31
            ? { ...episode, title: "Password: second" }
            : episode,
        )
      : body,
  );
  await expect(capturePrivateInstalledCorpus(f)).rejects.toMatchObject({
    diagnostic: { source: "sonarr", stage: "coherence", reason: "changed" },
  });
  expect(await readdir(f.directory)).toEqual([]);
});
