import { expect, test } from "vitest";
import { PlexMaintenanceClient } from "./plex-maintenance.ts";
import {
  digest,
  evaluateScan,
  preparePlan,
} from "#automation/plex-exclusion/evidence.ts";
import type {
  PlexScanObservation,
  PlexSectionSnapshot,
} from "#shared/plex-exclusion.ts";

const topology: PlexSectionSnapshot = {
  serverMachineId: "fixture-machine",
  serverVersion: "1.43.4.10903-e5521bd8c",
  sectionId: "1",
  sectionUuid: "fixture-section",
  kind: "movie",
  scanner: "Plex Movie",
  agent: "tv.plex.agents.movie",
  locations: ["/data/movies"],
  scannedAt: 100,
  refreshing: false,
};
const plan = preparePlan({
  runId: "00000000-0000-4000-8000-000000000001",
  recoveryEpoch: 1,
  runtimeVersion: 2,
  topology,
  libraryRoot: "/data/movies",
  rootMarkerBefore: "existing-pattern\n",
  controlMarkerBefore: null,
});
const observation = (
  time: number,
  paths = [plan.positivePath],
): PlexScanObservation => {
  const inventory = {
    itemCount: paths.length,
    parts: paths.map((path, index) => ({
      ratingKey: String(index + 1),
      partId: index + 1,
      path,
    })),
  };
  return {
    topology: { ...topology, scannedAt: 102 },
    inventory: { ...inventory, digest: digest(inventory) },
    observedAt: new Date(time).toISOString(),
    activeActivityIds: [],
  };
};
const input = () => ({
  plan,
  stagedAt: new Date(101_000).toISOString(),
  activityId: "scan-id",
  first: observation(103_000),
  second: observation(114_000),
});

test("requires stable complete evidence, a newer scan, positive visibility and negative exclusion", () => {
  expect(evaluateScan(input())).toEqual({ state: "verified" });
  expect(plan.rootMarkerAfter).toBe("existing-pattern\n.media-control/*\n");
  for (const change of [
    { first: observation(103_000, []) },
    { first: { ...observation(103_000), topology: { ...topology } } },
    { first: { ...observation(103_000), activeActivityIds: ["scan-id"] } },
    { second: observation(104_000) },
  ])
    expect(evaluateScan({ ...input(), ...change }).state).toBe("waiting");
  expect(
    evaluateScan({
      ...input(),
      first: observation(103_000, [plan.positivePath, plan.negativePath]),
    }),
  ).toEqual({ state: "intervention", reason: "control_path_visible_to_plex" });
  expect(
    evaluateScan({
      ...input(),
      first: {
        ...observation(103_000),
        topology: { ...topology, serverVersion: "changed" },
      },
    }),
  ).toEqual({ state: "intervention", reason: "plex_topology_changed" });
  expect(evaluateScan({ ...input(), cleanup: true }).state).toBe("waiting");
  expect(
    evaluateScan({
      ...input(),
      cleanup: true,
      first: observation(103_000, []),
      second: observation(114_000, []),
    }),
  ).toEqual({ state: "verified" });
});

test.each([false, true])(
  "rejects same-second pre-completion scan evidence (cleanup=%s)",
  (cleanup) => {
    const first = observation(103_000, cleanup ? [] : [plan.positivePath]);
    const second = observation(114_000, cleanup ? [] : [plan.positivePath]);
    // Positive could have been discovered at 101.200 before the negative was
    // created at 101.900; a whole-second watermark of 101 proves neither phase.
    first.topology.scannedAt = 101;
    second.topology.scannedAt = 101;
    expect(
      evaluateScan({
        ...input(),
        stagedAt: new Date(101_900).toISOString(),
        first,
        second,
        cleanup,
      }),
    ).toEqual({
      state: "waiting",
      reason: "scan_completion_unproven",
    });
    first.topology.scannedAt = 102;
    second.topology.scannedAt = 102;
    expect(
      evaluateScan({
        ...input(),
        stagedAt: new Date(101_900).toISOString(),
        first,
        second,
        cleanup,
      }),
    ).toEqual({ state: "verified" });
  },
);

test("uses live-observed section inventory and accepts empty activities without Activity key", async () => {
  const calls: string[] = [];
  const client = new PlexMaintenanceClient(
    {
      baseUrl: "http://plex.fixture",
      token: "fixture",
      clientIdentifier: "fixture",
    },
    async (url, init) => {
      calls.push(url.pathname);
      if (url.pathname === "/identity")
        return Response.json({
          MediaContainer: {
            machineIdentifier: topology.serverMachineId,
            version: topology.serverVersion,
            size: 0,
          },
        });
      if (url.pathname === "/activities")
        return Response.json({ MediaContainer: { size: 0 } });
      if (url.pathname.endsWith("/refresh")) {
        expect(init.method).toBe("POST");
        expect(url.searchParams.get("path")).toBe("/data/movies");
        return new Response(null, {
          headers: { "X-Plex-Activity": "scan-id" },
        });
      }
      expect(url.pathname).toBe("/library/sections");
      return Response.json({
        MediaContainer: {
          size: 1,
          Directory: [
            {
              key: "1",
              uuid: topology.sectionUuid,
              type: "movie",
              scanner: topology.scanner,
              agent: topology.agent,
              scannedAt: 100,
              refreshing: false,
              Location: [{ id: 1, path: "/data/movies" }],
            },
          ],
        },
      });
    },
  );
  expect(await client.topology("1")).toEqual(topology);
  expect(await client.activities()).toEqual([]);
  expect(await client.scanRoot(topology, "/data/movies")).toEqual({
    activityId: "scan-id",
  });
  await expect(
    client.scanRoot(topology, "/data/movies/.media-control"),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(calls).not.toContain("/library/sections/1");
});

test("inventory includes every Part including a merged hidden path and rejects partial or repeated pages", async () => {
  let body: unknown = {
    MediaContainer: {
      size: 1,
      totalSize: 1,
      Metadata: [
        {
          ratingKey: "1",
          type: "movie",
          title: "probe",
          Media: [
            {
              Part: [
                { id: 1, file: plan.positivePath },
                { id: 2, file: plan.negativePath },
              ],
            },
          ],
        },
      ],
    },
  };
  const client = new PlexMaintenanceClient(
    {
      baseUrl: "http://plex.fixture",
      token: "fixture",
      clientIdentifier: "fixture",
    },
    async () => Response.json(body),
  );
  const inventory = await client.inventory(topology, () => Promise.resolve());
  expect(inventory.parts).toHaveLength(2);
  body = { MediaContainer: { size: 0, totalSize: 1 } };
  await expect(
    client.inventory(topology, () => Promise.resolve()),
  ).rejects.toMatchObject({ kind: "invalid-response" });
  body = {
    MediaContainer: {
      size: 1,
      totalSize: 2,
      Metadata: [
        {
          ratingKey: "1",
          type: "movie",
          title: "probe",
          Media: [{ Part: [{ id: 1, file: plan.positivePath }] }],
        },
      ],
    },
  };
  await expect(
    client.inventory(topology, () => Promise.resolve()),
  ).rejects.toMatchObject({ kind: "invalid-response" });
});

test("metadata review identifies merged records without any delete request", async () => {
  let deletes = 0;
  let paths = [plan.positivePath, "/data/movies/unrelated.mkv"];
  const client = new PlexMaintenanceClient(
    {
      baseUrl: "http://plex.fixture",
      token: "fixture",
      clientIdentifier: "fixture",
    },
    async (url, init) => {
      expect(url.pathname).toBe("/library/metadata/9");
      if (init.method === "DELETE") {
        deletes++;
        return new Response();
      }
      return Response.json({
        MediaContainer: {
          size: 1,
          Metadata: [
            {
              ratingKey: "9",
              title: "probe",
              type: "movie",
              Media: [
                {
                  Part: paths.map((path, index) => ({
                    id: index + 1,
                    file: path,
                  })),
                },
              ],
            },
          ],
        },
      });
    },
  );
  await expect(
    client.inspectProbeMetadata("9", [plan.positivePath, plan.negativePath]),
  ).resolves.toMatchObject({ allPartsMatchProbes: false, paths });
  expect(deletes).toBe(0);
  paths = [plan.positivePath];
  await expect(
    client.inspectProbeMetadata("9", [plan.positivePath, plan.negativePath]),
  ).resolves.toMatchObject({ allPartsMatchProbes: true, paths });
  expect(deletes).toBe(0);
});
