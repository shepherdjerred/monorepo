import { expect, test } from "vitest";
import { associationFixture } from "#automation/publication/association/test-fixture.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { NativePlexProofParentSchema } from "#shared/plex-binding/native.ts";
import { plexScopeKey } from "#shared/plex-binding/contract.ts";
import type { NativeCatalogScope } from "./scope.ts";
import { scanNativePlex, finishNativePlex } from "./observation.ts";

/** Synthetic immutable descriptors and injected wire only; no DB/ownership acceptance claim. */
function fixture(kind: "movie" | "episode" = "movie", compensation = false) {
  const f = associationFixture(kind, kind === "episode" ? 2 : 1);
  const physical = f.input.expected.newGroups[0];
  const access = f.input.access[0];
  if (physical === undefined || access === undefined)
    throw new Error("Synthetic descriptor missing");
  const catalog: NativeCatalogScope = {
    groups: [
      {
        canonicalPath: physical.canonicalPath,
        access,
        targets: f.input.canonicalTargets,
        allowedSizes: compensation ? ["128", "256"] : ["128"],
        required: !compensation,
      },
    ],
    physical: new Map(compensation ? [] : [[physical.canonicalPath, physical]]),
    definitions: new Map(
      f.input.expected.targets.map((target) => [
        plexScopeKey(target.scope),
        target.definition,
      ]),
    ),
    compensation: compensation
      ? [
          {
            entryOperationId: "synthetic-import",
            entryHash: "e".repeat(64),
            canonicalPath: physical.canonicalPath,
            access,
            compatiblePhysicalCandidates: [
              {
                role: "predecessor",
                assetId: physical.assetId,
                sourceHash: "a".repeat(64),
              },
              {
                role: "successor",
                assetId: crypto.randomUUID(),
                sourceHash: "b".repeat(64),
              },
            ],
            targets: [...f.input.canonicalTargets],
          },
        ]
      : undefined,
    absent: [],
    paths: [physical.canonicalPath],
    access: [access],
    canonicalTargets: [...f.input.canonicalTargets],
  };
  const parent = NativePlexProofParentSchema.parse({
    purpose: "native_review",
    networkKind: "network",
    lifecycleKind: compensation ? "publication_compensation" : "published",
    planId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    scopeHash: "f".repeat(64),
    recoveryEpoch: 0,
  });
  const freshness = plexBindingFreshness({ ...f.input, guards: [f.execution] });
  const create = (hook?: Parameters<typeof f.createClient>[0]) => ({
    plex: f.createClient(
      (url, init) =>
        hook?.(url, init) ??
        (url.pathname === "/status/sessions"
          ? Response.json({ MediaContainer: { size: 0, Metadata: [] } })
          : undefined),
    ),
    execution: f.execution,
    freshness,
  });
  const observe = async (hook?: Parameters<typeof f.createClient>[0]) => {
    const context = create(hook);
    const scanned = await scanNativePlex(context, catalog);
    return finishNativePlex(context, {
      scope: { media: [] },
      catalog,
      parent,
      scanned,
      observed: f.input.observed,
    });
  };
  return { ...f, catalog, observe, create, parent };
}

test("inventory verification finishes before a later actual session observation", async () => {
  const f = fixture();
  const context = f.create();
  const scanned = await scanNativePlex(context, f.catalog);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const result = await finishNativePlex(context, {
    scope: { media: [] },
    catalog: f.catalog,
    parent: f.parent,
    scanned,
    observed: f.input.observed,
  });
  expect(result.observation.verification.completedAt).toBe(scanned.completedAt);
  expect(Date.parse(result.observation.verification.completedAt)).toBeLessThan(
    Date.parse(result.timing.sessionsCheckedAt),
  );
  expect(Date.parse(result.timing.sessionsCheckedAt)).toBeLessThanOrEqual(
    Date.parse(result.timing.completedAt),
  );
  expect(f.calls.at(-1)?.pathname).toBe("/status/sessions");
});

test.each(["movie", "episode"] as const)(
  "native %s reads two complete passes and actual hierarchy before final sessions",
  async (kind) => {
    const f = fixture(kind);
    for (const item of [...f.items, ...f.metadata.values()])
      item.librarySectionID = 1;
    const result = await f.observe();
    expect(result.observation.present).toHaveLength(kind === "movie" ? 1 : 2);
    expect(f.calls.at(-1)?.pathname).toBe("/status/sessions");
    expect(f.calls.filter((url) => url.pathname.endsWith("/all"))).toHaveLength(
      2,
    );
    for (const item of f.items)
      expect(
        f.calls.filter(
          (url) => url.pathname === `/library/metadata/${item.ratingKey}`,
        ),
      ).toHaveLength(2);
    if (kind === "episode")
      expect(result.observation.present[0]).toMatchObject({
        hierarchy: { season: { sectionId: "1" }, show: { sectionId: "1" } },
      });
  },
);

test.each(["absent", "predecessor-size", "successor-size", "no-size"])(
  "compensation %s records candidates without choosing served bytes",
  async (mode) => {
    const f = fixture("movie", true);
    const part = f.items[0]?.Media?.[0]?.Part[0];
    if (part === undefined) throw new Error("Synthetic Part missing");
    for (const item of f.items) item.librarySectionID = 1;
    if (mode === "absent") f.items.length = 0;
    if (mode === "successor-size") part.size = 256;
    if (mode === "no-size") delete part.size;
    const result = await f.observe();
    expect(result.observation.present).toEqual([]);
    const entry = result.observation.compensationCatalog?.[0];
    expect(entry?.items).toHaveLength(mode === "absent" ? 0 : 1);
    if (mode !== "absent") {
      expect(entry?.items[0]).toMatchObject({ sectionId: "1" });
      expect(entry?.items[0]?.item).not.toHaveProperty("sectionId");
    }
    expect(
      entry?.compatiblePhysicalCandidates.map((value) => value.role),
    ).toEqual(["predecessor", "successor"]);
  },
);

test.each([
  "section",
  "root",
  "multipart",
  "changed-second-pass",
  "control-session",
])("native wire %s cannot yield a paired positive", async (failure) => {
  const f = fixture("episode");
  const show = f.metadata.get("901");
  const item = f.items[0];
  if (show === undefined || item === undefined)
    throw new Error("Synthetic hierarchy missing");
  if (failure === "section") show.librarySectionID = 2;
  if (failure === "root") show.Guid = [{ id: "tmdb://999" }];
  if (failure === "multipart")
    item.Media?.[0]?.Part.push({
      id: 501,
      file: "/data/tv/other.mkv",
      size: 128,
    });
  let inventories = 0;
  await expect(
    f.observe((url) => {
      const secondInventory =
        url.pathname.endsWith("/all") && ++inventories === 2;
      if (failure === "changed-second-pass" && secondInventory)
        item.Guid = [{ id: "tvdb://456" }];
      if (failure === "control-session" && url.pathname === "/status/sessions")
        return Response.json({
          MediaContainer: {
            size: 1,
            Metadata: [
              {
                ratingKey: "777",
                type: "movie",
                title: "Unknown",
                Media: [
                  {
                    Part: [
                      {
                        id: 700,
                        file: "/data/tv/.media-control/rejected/foreign",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        });
      return;
    }),
  ).rejects.toMatchObject(
    failure === "control-session"
      ? { code: "native_plex_playback_active_or_unknown" }
      : {
          reason:
            failure === "section"
              ? "wrong_section"
              : failure === "root"
                ? "unresolved_identity"
                : failure === "multipart"
                  ? "unsupported_media_parts"
                  : "metadata_changed",
        },
  );
});
