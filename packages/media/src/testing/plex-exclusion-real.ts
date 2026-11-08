import { setTimeout } from "node:timers/promises";
import path from "node:path";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { FileContext } from "#automation/files/types.ts";
import { createPlexExclusionFileActivities } from "#automation/plex-exclusion/files.ts";
import { createPlexExclusionNetworkActivities } from "#automation/plex-exclusion/network.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import { requireMarkers } from "#filesystem/plex-exclusion-probe.ts";
import { PrismaPlexExclusionAdministration } from "#infrastructure/plex-exclusion-service.ts";
import { PlexMaintenanceClient } from "#integrations/plex-maintenance.ts";
import { PlexExclusionPlanSchema } from "#shared/plex-exclusion.ts";

/** Genuine initial observe-mode producer. Only the external scanner's HTTP transport is synthetic. */
export async function prepareActualMovieExclusion(
  files: FileContext,
  owner: MediaActor,
) {
  const db = files.db;
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (runtime.mode !== "observe" || runtime.ownershipConfirmed)
    throw new Error(
      "Initial scanner preparation must precede ownership adoption",
    );
  const previous = files.pathMapping;
  if (previous === undefined)
    throw new Error("Initial fixture mapping missing");
  const mapping = {
    canonical: previous.canonical,
    local(stored: string) {
      for (const kind of ["movies", "tv"] as const) {
        for (const root of ["control", "library"] as const) {
          const canonical = `/data/${kind}${root === "control" ? "/.media-control" : ""}`;
          if (stored === canonical || stored.startsWith(`${canonical}/`))
            return path.join(
              files.roots[kind][root],
              stored.slice(canonical.length),
            );
        }
      }
      return previous.local(stored);
    },
  };
  const service = new PrismaPlexExclusionAdministration(db, () =>
    Promise.reject(
      new Error("Initial scanner preparation never recovers a workflow"),
    ),
  );
  const scanner = actualScannerWire();
  const network = createPlexExclusionNetworkActivities({
    db,
    plex: scanner.plex,
    machineId: "fixture-server",
    permittedSections: () => Promise.resolve({ movie: "1", series: "2" }),
    checkpoint: () => files.checkpoint("plex-exclusion"),
  });
  const native = createPlexExclusionFileActivities({
    db,
    roots: { movies: "/data/movies", tv: "/data/tv" },
    checkpoint: () => files.checkpoint("plex-exclusion"),
    pathMapping: mapping,
  });
  const prepared = await service.prepare(owner, crypto.randomUUID(), {
    kind: "movies",
    expectedRuntimeVersion: runtime.version,
  });
  const initial = {
    runId: z.uuid().parse(prepared.runId),
    operationId: z.uuid().parse(prepared.operationId),
  };
  await network.preparePlexExclusionTopology(initial);
  await native.preparePlexExclusionFiles(initial);
  const detail = await service.detail(owner, initial.runId);
  const plan = PlexExclusionPlanSchema.parse(detail.plan);
  scanner.setPositivePath(plan.positivePath);
  const approved = await service.execute(
    owner,
    crypto.randomUUID(),
    initial.runId,
    { expectedVersion: detail.version, planDigest: detail.planDigest },
  );
  const input = {
    runId: initial.runId,
    operationId: z.uuid().parse(approved.operationId),
  };
  await network.validatePlexExclusionExecution(input);
  await native.stagePlexExclusionFiles(input);
  for (const cleanup of [false, true]) {
    if (cleanup) await native.cleanupPlexExclusionFiles(input);
    // Plex scanner timestamps have whole-second precision; wait for the actual next boundary.
    await setTimeout(1001 - (Date.now() % 1000));
    const first = await network.reconcilePlexExclusionScan({
      ...input,
      cleanup,
    });
    if (first.state !== "waiting")
      throw new Error(`Unexpected first scanner observation: ${first.state}`);
    await setTimeout(10_000);
    const second = await network.reconcilePlexExclusionScan({
      ...input,
      cleanup,
    });
    if (second.state !== "verified")
      throw new Error(
        `Actual scanner observation did not verify: ${JSON.stringify(second.reason)}`,
      );
  }
  await network.finishPlexExclusion(input);
  await requirePlexExclusionDatabaseProof(db, {
    library: plan.libraryRoot,
    control: plan.controlRoot,
  });
  await requireMarkers(plan, mapping);
  files.pathMapping = mapping;
  files.verifyPlexExclusion = async (roots) => {
    if (
      roots.library !== files.roots.movies.library ||
      roots.control !== files.roots.movies.control
    )
      throw new Error(
        "Actual movie scanner proof cannot authorize another root",
      );
    await requirePlexExclusionDatabaseProof(db, {
      library: plan.libraryRoot,
      control: plan.controlRoot,
    });
    await requireMarkers(plan, mapping);
  };
}

function actualScannerWire() {
  let positivePath = "";
  let scans = 0;
  let scannedAt = 1;
  const plex = new PlexMaintenanceClient(
    {
      baseUrl: "http://plex.fixture",
      token: "synthetic-exclusion",
      clientIdentifier: "synthetic-exclusion",
    },
    (url) => {
      if (url.pathname === "/identity")
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              machineIdentifier: "fixture-server",
              version: "1.43.4.10903-e5521bd8c",
            },
          }),
        );
      if (url.pathname === "/library/sections")
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: 1,
              Directory: [
                {
                  key: "1",
                  uuid: "synthetic-history-movies",
                  type: "movie",
                  scanner: "Plex Movie",
                  agent: "tv.plex.agents.movie",
                  scannedAt,
                  refreshing: false,
                  Location: [{ id: 1, path: "/data/movies" }],
                },
              ],
            },
          }),
        );
      if (url.pathname === "/activities")
        return Promise.resolve(Response.json({ MediaContainer: { size: 0 } }));
      if (url.pathname === "/library/sections/1/refresh") {
        scans++;
        scannedAt = Math.floor(Date.now() / 1000);
        return Promise.resolve(
          new Response(null, {
            headers: { "X-Plex-Activity": "synthetic-scan" },
          }),
        );
      }
      if (url.pathname !== "/library/sections/1/all")
        throw new Error(
          `Unexpected synthetic scanner endpoint ${url.pathname}`,
        );
      const visible = scans === 1;
      return Promise.resolve(
        Response.json({
          MediaContainer: {
            size: visible ? 1 : 0,
            totalSize: visible ? 1 : 0,
            Metadata: visible
              ? [
                  {
                    ratingKey: "9",
                    title: "Actual exclusion probe",
                    type: "movie",
                    Media: [{ Part: [{ id: 1, file: positivePath }] }],
                  },
                ]
              : [],
          },
        }),
      );
    },
  );
  return {
    plex,
    setPositivePath(value: string) {
      positivePath = value;
    },
  };
}
