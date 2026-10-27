import assert from "node:assert/strict";
import path from "node:path";
import { z } from "zod";
import type { PlexItem } from "#integrations/plex.ts";
import type { Manifest } from "./manifest.ts";
import { until, type PmsWire } from "./http.ts";

const Sections = z.array(
  z.object({
    key: z.string().regex(/^\d+$/u),
    type: z.enum(["movie", "show"]),
    title: z.string(),
    agent: z.string(),
    scanner: z.string(),
    refreshing: z.boolean(),
    scannedAt: z.number().optional(),
    Location: z.array(z.object({ path: z.string() })),
  }),
);

export async function createLibraries(
  wire: PmsWire,
  manifest: Pick<Manifest, "root">,
) {
  const providers = await wire.request("/media/providers/metadata");
  const agents = z
    .array(z.object({ identifier: z.string() }))
    .parse(providers["MetadataAgentProvider"]);
  for (const identifier of ["tv.plex.agents.movie", "tv.plex.agents.series"])
    assert.ok(
      agents.some((agent) => agent.identifier === identifier),
      `Required actual PMS agent unavailable: ${identifier}`,
    );
  const specifications = [
    {
      kind: "movie",
      agent: "tv.plex.agents.movie",
      scanner: "Plex Movie",
    },
    {
      kind: "show",
      agent: "tv.plex.agents.series",
      scanner: "Plex TV Series",
    },
  ] as const;
  for (const item of specifications)
    await wire.request(
      "/library/sections",
      {
        name: `Synthetic ${item.kind}`,
        type: item.kind,
        agent: item.agent,
        scanner: item.scanner,
        language: "en-US",
        location: path.join(manifest.root, "media", item.kind),
      },
      "POST",
      201,
    );
  const container = await wire.request("/library/sections");
  const sections = Sections.parse(container["Directory"]);
  assert.equal(
    sections.length,
    specifications.length,
    "Fresh server contains only the two owned synthetic libraries",
  );
  for (const specification of specifications) {
    const section = sections.find((item) => item.type === specification.kind);
    assert.ok(section, `Created ${specification.kind} section missing`);
    assert.equal(section.agent, specification.agent);
    assert.equal(section.scanner, specification.scanner);
    assert.deepEqual(
      section.Location.map((location) => location.path),
      [path.join(manifest.root, "media", specification.kind)],
    );
  }
  return sections;
}

export async function allItems(
  wire: PmsWire,
  sectionId: string,
  kind: "movie" | "episode",
) {
  const first = await wire.client.libraryPage({
    sectionId,
    kind,
    offset: 0,
    limit: 2,
  });
  assert.ok(
    first.total <= 10,
    "Synthetic fixture unexpectedly exceeded bounded inventory",
  );
  const items = [...first.items];
  while (items.length < first.total) {
    const page = await wire.client.libraryPage({
      sectionId,
      kind,
      offset: items.length,
      limit: 2,
    });
    assert.equal(
      page.total,
      first.total,
      "PMS inventory changed within paged read",
    );
    items.push(...page.items);
  }
  assert.equal(items.length, first.total);
  assert.equal(new Set(items.map((item) => item.ratingKey)).size, items.length);
  return items;
}

function part(item: PlexItem, files: Manifest["files"]) {
  const parts = item.Media?.flatMap((media) => media.Part) ?? [];
  assert.equal(
    parts.length,
    1,
    "Each synthetic item must expose its single actual physical Part",
  );
  const actual = parts[0];
  assert.ok(actual);
  const expected = files.find((file) => file.path === actual.file);
  assert.ok(expected, "PMS Part path escaped exact synthetic manifest");
  assert.equal(actual.size, expected.size);
  return expected;
}

async function movies(wire: PmsWire, items: PlexItem[], manifest: Manifest) {
  const seen = new Set<string>();
  const verified = [];
  for (const item of items) {
    const parsed = await wire.client.metadata(item.ratingKey);
    const expected = part(
      parsed,
      manifest.files.filter((file) => file.kind === "movie"),
    );
    assert.ok(
      !seen.has(expected.path),
      "Movie editions merged or a physical file duplicated",
    );
    seen.add(expected.path);
    const raw = await wire.request(`/library/metadata/${item.ratingKey}`, {
      includeGuids: "1",
    });
    const [metadata] = z
      .array(
        z.object({
          ratingKey: z.string(),
          editionTitle: z.string().optional(),
        }),
      )
      .length(1)
      .parse(raw["Metadata"]);
    assert.ok(metadata);
    assert.equal(metadata.ratingKey, item.ratingKey);
    if (expected.edition === null)
      assert.ok(
        metadata.editionTitle === undefined || metadata.editionTitle === "",
        "Unmarked movie acquired an inferred edition",
      );
    else
      assert.equal(
        metadata.editionTitle,
        expected.edition,
        "Required filename edition not recognized by pinned PMS",
      );
    verified.push({ metadata, path: expected.path, size: expected.size });
  }
  assert.equal(
    seen.size,
    3,
    "All three distinct unmarked/named physical files must be represented",
  );
  return verified;
}

async function episodes(wire: PmsWire, items: PlexItem[], manifest: Manifest) {
  const seen = new Set<number>();
  const shared = new Map<string, string[]>();
  const verified = [];
  for (const item of items) {
    const episode = await wire.client.metadata(item.ratingKey);
    const expected = part(
      episode,
      manifest.files.filter((file) => file.kind === "show"),
    );
    assert.equal(episode.type, "episode");
    assert.equal(episode.parentIndex, 1);
    assert.ok(
      episode.index !== undefined && expected.episodes.includes(episode.index),
    );
    assert.ok(!seen.has(episode.index));
    seen.add(episode.index);
    assert.ok(
      episode.parentRatingKey !== undefined &&
        episode.parentRatingKey.length > 0 &&
        episode.grandparentRatingKey !== undefined &&
        episode.grandparentRatingKey.length > 0,
    );
    const season = await wire.client.metadata(episode.parentRatingKey);
    const show = await wire.client.metadata(episode.grandparentRatingKey);
    assert.equal(season.type, "season");
    assert.equal(season.index, 1);
    assert.equal(season.parentRatingKey, show.ratingKey);
    assert.equal(show.type, "show");
    assert.equal(
      new Set([episode.ratingKey, season.ratingKey, show.ratingKey]).size,
      3,
    );
    shared.set(expected.path, [
      ...(shared.get(expected.path) ?? []),
      episode.ratingKey,
    ]);
    verified.push({ episode, season, show });
  }
  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    [1, 2, 3],
  );
  const packed = manifest.files.find((file) => file.episodes.length === 2);
  assert.ok(packed);
  assert.equal(
    shared.get(packed.path)?.length,
    2,
    "Shared file must emit both independently keyed episode members",
  );
  return verified;
}

export async function assertLibraryWire(
  wire: PmsWire,
  manifest: Manifest,
  signal: AbortSignal,
) {
  const sections = await createLibraries(wire, manifest);
  for (const section of sections)
    await wire.client.refresh(section.key, signal);
  let stable = 0;
  const inventory = await until(
    "complete synthetic scan",
    async () => {
      const response = await wire.request("/library/sections");
      const state = Sections.parse(response["Directory"]);
      assert.deepEqual(
        state.map((item) => item.key).sort(),
        sections.map((item) => item.key).sort(),
      );
      const groups = [];
      for (const section of state)
        groups.push({
          section,
          items: await allItems(
            wire,
            section.key,
            section.type === "movie" ? "movie" : "episode",
          ),
        });
      const complete = groups.every(
        (group) =>
          !group.section.refreshing &&
          (group.section.scannedAt ?? 0) > 0 &&
          group.items.length === 3,
      );
      stable = complete ? stable + 1 : 0;
      return stable >= 2 ? groups : null;
    },
    signal,
  );
  const verified = [];
  for (const group of inventory)
    verified.push({
      sectionId: group.section.key,
      kind: group.section.type,
      evidence:
        group.section.type === "movie"
          ? await movies(wire, group.items, manifest)
          : await episodes(wire, group.items, manifest),
    });
  return verified;
}
