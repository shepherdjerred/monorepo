import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { handoffFixture } from "#automation/handoff/test-fixture.ts";
import { createAutomationTestContext } from "#testing/automation.ts";
import { createHandoffNetworkActivities } from "./handoff.ts";
import {
  HandoffNetworkV2Schema,
  PrepareLibraryHandoffV2Schema,
} from "#shared/handoff-v2.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("library-only network runtime never authenticates or inventories existing torrents", async () => {
  const f = await handoffFixture(cluster.database, {
    initialEdition: "directors_cut",
    fileName: "Synthetic Film {edition-Director's Cut}.mkv",
    prepareRequest({ request, report }) {
      const files = report.entries.filter((entry) => entry.kind === "file");
      return PrepareLibraryHandoffV2Schema.parse({
        ...request,
        schemaVersion: 2,
        purpose: "migration",
        selected: files.map((file) => ({
          provenanceKey: file.provenanceKey,
          evidenceHash: file.observationHash,
        })),
        movies: files.map((file) => ({
          provenanceKey: file.provenanceKey,
          edition: "directors_cut",
          resolution: { kind: "conventional" },
        })),
      });
    },
  });
  directories.push(f.directory);
  const context = createAutomationTestContext(
    cluster.database,
    f.network.context.cipher,
  );
  context.plex.machineIdentifier = f.network.context.plex.machineIdentifier;
  context.plex.sections = f.network.context.plex.sections;
  context.plex.libraryPage = f.network.context.plex.libraryPage;
  context.plex.metadata = f.network.context.plex.metadata;
  context.qbittorrent.login = () =>
    Promise.reject(
      new Error("Library-only handoff must not authenticate torrents"),
    );
  context.qbittorrent.listAll = () =>
    Promise.reject(
      new Error("Library-only handoff must not inventory torrents"),
    );
  const activities = createHandoffNetworkActivities(context, {
    observer: f.network.context.observer,
    expectedServerMachineId: "server",
    serverUrl: "http://plex.fixture",
    publicOrigin: "https://media.fixture",
    canonicalRoots: f.network.context.canonicalRoots,
  });
  const operation = await cluster.database.operation.findUniqueOrThrow({
    where: { idempotencyKey: `handoff-prepare:${f.planId}` },
  });
  await activities.observeMediaHandoff({
    planId: f.planId,
    operationId: operation.id,
  });
  const observation =
    await cluster.database.mediaHandoffObservation.findFirstOrThrow({
      where: { planId: f.planId, kind: "network" },
    });
  expect(HandoffNetworkV2Schema.parse(observation.evidence)).toMatchObject({
    torrents: [],
    claims: [],
  });
});
