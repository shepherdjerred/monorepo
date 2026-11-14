import { expect, test } from "vitest";
import fixture from "#domain/quality-guide/guide-fixture.json";
import { GUIDE_PRESETS } from "#domain/quality-guide/contract.ts";
import { compileQualityGuide } from "#domain/quality-guide/compile.ts";
import { TrashGuideClient } from "./client.ts";
import type { FetchTransport } from "#integrations/http.ts";

function wire(
  transform: (value: unknown, path: string) => unknown = (value) => value,
) {
  const paths: string[] = [];
  const source = fixture.sources.movie;
  const documents = new Map<string, unknown>(
    GUIDE_PRESETS.movie.formats.map((selected) => [
      selected.path,
      source.formats.find((format) => format.trash_id === selected.id),
    ]),
  );
  documents.set(GUIDE_PRESETS.movie.qualitySizePath, source.sizes);
  const profilePath = GUIDE_PRESETS.movie.profilePath;
  if (profilePath === undefined)
    throw new Error("Missing selected profile fixture");
  documents.set(profilePath, source.profile);
  const transport: FetchTransport = (url, init) => {
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    paths.push(url.href);
    if (url.pathname.endsWith("/git/ref/heads/master"))
      return Promise.resolve(
        Response.json({ object: { sha: fixture.revision, type: "commit" } }),
      );
    if (url.pathname.endsWith(`/git/commits/${fixture.revision}`))
      return Promise.resolve(
        Response.json({
          sha: fixture.revision,
          committer: { date: fixture.committedAt },
        }),
      );
    const prefix = `/TRaSH-Guides/Guides/${fixture.revision}/`;
    if (
      url.hostname !== "raw.githubusercontent.com" ||
      !url.pathname.startsWith(prefix)
    )
      throw new Error("Guide read escaped its pinned revision");
    const path = url.pathname.slice(prefix.length);
    if (!documents.has(path))
      throw new Error("Unexpected unselected guide resource");
    return Promise.resolve(Response.json(transform(documents.get(path), path)));
  };
  return { transport, paths };
}

test("fetches only selected fixed paths at one immutable revision and produces the validated real profile", async () => {
  const fake = wire();
  const bundle = await new TrashGuideClient(fake.transport).load("movie");
  expect(bundle.revision).toBe(fixture.revision);
  expect(fake.paths).toHaveLength(GUIDE_PRESETS.movie.formats.length + 4);
  expect(
    compileQualityGuide("movie", bundle).rules.resolved?.customFormats,
  ).toHaveLength(53);
  expect(
    fake.paths
      .filter((url) => url.includes("raw.githubusercontent.com"))
      .every((url) => url.includes(fixture.revision)),
  ).toBe(true);
});
test("refuses a changed format identity and an oversized upstream document", async () => {
  const changed = wire((value, path) =>
    path.endsWith("hdr.json") ? { trash_id: "a".repeat(32) } : value,
  );
  await expect(
    new TrashGuideClient(changed.transport).load("movie"),
  ).rejects.toThrow();
  const oversized = wire((value, path) =>
    path.endsWith("hdr.json") ? { payload: "x".repeat(600_000) } : value,
  );
  await expect(
    new TrashGuideClient(oversized.transport).load("movie"),
  ).rejects.toMatchObject({ service: "trash-guide", kind: "invalid-response" });
});
