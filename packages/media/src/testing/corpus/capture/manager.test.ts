import { expect, test } from "vitest";
import { captureInstalledCatalog } from "./manager.ts";
import { installedCaptureFixture } from "./test-fixture.ts";

test("installed capture retains actual movie fields without copying unknown credential or URL fields", async () => {
  const f = installedCaptureFixture();
  const source = f.sources[0];
  if (source === undefined) throw new Error("Synthetic source missing");
  const result = await captureInstalledCatalog(source, f.transport);
  expect(result).toMatchObject({
    source: "radarr",
    sourceVersion: "6.4.4.10685",
    movies: [
      {
        title: "Paper Lantern",
        year: 2024,
        runtime: 97,
        alternateTitles: [{ title: "Lantern" }],
      },
    ],
    files: [{ size: 2_345_678_901 }],
  });
  expect(JSON.stringify(result)).not.toMatch(
    /apiKey|downloadUrl|discard-this-field/u,
  );
  expect(f.calls).toHaveLength(6);
});
test("series capture keeps shared file coordinates and missing runtime/aliases/probe observations absent", async () => {
  const f = installedCaptureFixture();
  const source = f.sources[1];
  if (source === undefined) throw new Error("Synthetic source missing");
  const result = await captureInstalledCatalog(source, f.transport);
  if (result.source !== "sonarr") throw new Error("Expected series capture");
  expect(result.episodes.map((episode) => episode.episodeFileId)).toEqual([
    41, 41,
  ]);
  expect(result.series[0]).not.toHaveProperty("runtime");
  expect(result.series[0]).not.toHaveProperty("alternateTitles");
  expect(result.episodes[1]).not.toHaveProperty("title");
  expect(result.files[0]).not.toHaveProperty("probe");
  expect(f.calls).toHaveLength(8);
});
test("changed complete observations fail rather than selecting one pass", async () => {
  const f = installedCaptureFixture();
  const source = f.sources[0];
  if (source === undefined) throw new Error("Synthetic source missing");
  let reads = 0;
  f.change((url, body) =>
    url.pathname === "/api/v3/movie" && ++reads === 2
      ? [{ ...f.movie, year: 2025 }]
      : body,
  );
  await expect(
    captureInstalledCatalog(source, f.transport),
  ).rejects.toMatchObject({
    diagnostic: { source: "radarr", stage: "coherence", reason: "changed" },
  });
});
test.each(["wrong_parent", "missing_file", "duplicate_id"] as const)(
  "series capture refuses %s without inventing coverage",
  async (change) => {
    const f = installedCaptureFixture();
    const source = f.sources[1];
    if (source === undefined) throw new Error("Synthetic source missing");
    const episode = f.episodes[0];
    if (episode === undefined) throw new Error("Synthetic episode missing");
    if (change === "wrong_parent") episode.seriesId = 999;
    if (change === "missing_file") episode.episodeFileId = 999;
    if (change === "duplicate_id") f.episodes.push({ ...episode });
    await expect(
      captureInstalledCatalog(source, f.transport),
    ).rejects.toMatchObject({
      diagnostic: {
        source: "sonarr",
        stage: "installed_first",
        reason:
          change === "wrong_parent"
            ? "changed"
            : change === "missing_file"
              ? "missing_reference"
              : "duplicate_id",
      },
    });
  },
);
