import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { assertNoPendingPlexEdits } from "#infrastructure/handoff/plex-edit-records.ts";
import { PlexEditionCompletionV1Schema } from "#shared/handoff/plex-edition.ts";
import { libraryPlexFixture } from "./plex-edit-fixture.ts";
import { prepareLibraryPlexEditFileV3 } from "./plex-edit-files.ts";
import { editLibraryPlexEditionV3 } from "./plex-edit-network.ts";
import { applyPreparedHandoff } from "./apply.ts";
import { prepareHandoffFiles } from "./files.ts";
import { finishHandoffPreparation } from "./plan.ts";
import { PrepareLibraryHandoffV2Schema } from "#shared/handoff-v2.ts";
import { createHandoffNetworkProducer } from "#migration/handoff-network/producer.ts";

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
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function fixture() {
  const f = await libraryPlexFixture(cluster.database, "directors_cut");
  directories.push(f.directory);
  const ready = await f.ready();
  const input = {
    ...ready.input,
    schemaVersion: 3 as const,
    assetId: z.uuid().parse(ready.prepared.scope.files[0]?.assetId),
  };
  const filesObservation = await prepareLibraryPlexEditFileV3(
    f.context,
    input,
    testPublicationExecution(),
  );
  const edit = vi.fn(() => {
    f.setItem({ ...f.item(), editionTitle: "Director's Cut" });
    return Promise.resolve();
  });
  const context = {
    db: cluster.database,
    expectedServerMachineId: await f.network.context.plex.machineIdentifier(),
    plex: {
      machineIdentifier: f.network.context.plex.machineIdentifier,
      metadataForEditionEdit: () => Promise.resolve(f.item()),
      editMovieEdition: edit,
    },
  };
  return {
    ...f,
    ready,
    input: { ...input, filesObservation },
    contextForEdit: context,
    edit,
  };
}

test.each(["owner", "runtime", "server", "part", "path", "label"] as const)(
  "v3 refuses a changed %s before persisting an intent or editing Plex",
  async (changed) => {
    const f = await fixture();
    if (changed === "owner")
      await cluster.database.mediaUser.update({
        where: { id: f.network.actor.id },
        data: { restricted: true },
      });
    if (changed === "runtime")
      await cluster.database.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: { version: { increment: 1 } },
      });
    if (changed === "server")
      f.contextForEdit.plex.machineIdentifier = () =>
        Promise.resolve("different-server");
    if (changed === "label")
      f.setItem({ ...f.item(), editionTitle: "Unexpected second label" });
    if (changed === "part" || changed === "path")
      f.setItem({
        ...f.item(),
        Media: [
          {
            Part: [
              {
                id:
                  changed === "part"
                    ? 999
                    : (f.item().Media?.[0]?.Part[0]?.id ?? 0),
                file: changed === "path" ? "/different/path.mkv" : f.target,
              },
            ],
          },
        ],
      });
    await expect(
      editLibraryPlexEditionV3(
        f.contextForEdit,
        f.input,
        bindingTestExecution(),
      ),
    ).rejects.toThrow();
    expect(f.edit).not.toHaveBeenCalled();
    expect(
      await cluster.database.mediaHandoffObservation.count({
        where: { planId: f.planId, kind: "plex_edit_intent_v1" },
      }),
    ).toBe(0);
    expect(
      await cluster.database.mediaHandoffReceipt.findUnique({
        where: { planId: f.planId },
      }),
    ).toBeNull();
  },
);

test("a renewed observation cannot extend the original file/network authority", async () => {
  const f = await fixture();
  const original =
    await cluster.database.mediaHandoffObservation.findUniqueOrThrow({
      where: { id: f.input.filesObservation.id },
    });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(original.expiresAt.getTime() + 1);
  const observe = f.network.context.observer.observe.bind(
    f.network.context.observer,
  );
  f.network.context.observer.observe = async (...args) => ({
    ...(await observe(...args)),
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
  });
  const mounts = f.network.context.observer.observeMountBindings.bind(
    f.network.context.observer,
  );
  f.network.context.observer.observeMountBindings = async (...args) => ({
    ...(await mounts(...args)),
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
  });
  await f.observe();
  await expect(
    editLibraryPlexEditionV3(f.contextForEdit, f.input, bindingTestExecution()),
  ).rejects.toThrow("stale");
  expect(f.edit).not.toHaveBeenCalled();
});

test("an uncertain undelivered write is observe-only and fences ownership until its actual label is confirmed", async () => {
  const f = await fixture();
  f.edit.mockImplementation(() =>
    Promise.reject(new Error("Synthetic ambiguous connection failure")),
  );
  for (const _attempt of [1, 2])
    await expect(
      editLibraryPlexEditionV3(
        f.contextForEdit,
        f.input,
        bindingTestExecution(),
      ),
    ).rejects.toMatchObject({ code: "handoff_plex_edit_label_unconfirmed" });
  expect(f.edit).toHaveBeenCalledTimes(1);
  await expect(
    cluster.database.$transaction((tx) =>
      assertNoPendingPlexEdits(
        tx,
        [{ canonicalPath: f.target }],
        new PublicationAuthorityReadBudget(),
      ),
    ),
  ).rejects.toThrow("remains uncertain");
  await expect(
    applyPreparedHandoff(
      f.context,
      f.ready.input,
      await prepareHandoffFiles(f.context, f.planId),
    ),
  ).rejects.toThrow();
  await cluster.database.mediaHandoffPlan.update({
    where: { id: f.planId },
    data: { state: "requires_review" },
  });
  await cluster.database.mediaUser.update({
    where: { id: f.network.actor.id },
    data: { restricted: true },
  });
  await cluster.database.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { version: { increment: 1 } },
  });
  f.setItem({ ...f.item(), editionTitle: "Director's Cut" });
  const result = await editLibraryPlexEditionV3(
    f.contextForEdit,
    f.input,
    bindingTestExecution(),
  );
  const completion =
    await cluster.database.mediaHandoffObservation.findUniqueOrThrow({
      where: { id: result.id },
    });
  expect(
    PlexEditionCompletionV1Schema.parse(completion.evidence).response,
  ).toBe("lost_or_unobserved");
  await expect(
    cluster.database.$transaction((tx) =>
      assertNoPendingPlexEdits(
        tx,
        [{ canonicalPath: f.target }],
        new PublicationAuthorityReadBudget(),
      ),
    ),
  ).resolves.toBeUndefined();
  expect(f.edit).toHaveBeenCalledTimes(1);
  expect(
    await cluster.database.mediaHandoffReceipt.findUnique({
      where: { planId: f.planId },
    }),
  ).toBeNull();
});

test("watch regression blocks completion and retry cannot repeat the edit", async () => {
  const f = await fixture();
  f.edit.mockImplementation(() => {
    f.setItem({ ...f.item(), editionTitle: "Director's Cut", viewOffset: 0 });
    return Promise.resolve();
  });
  await expect(
    editLibraryPlexEditionV3(f.contextForEdit, f.input, bindingTestExecution()),
  ).rejects.toMatchObject({ code: "handoff_plex_edit_watch_changed" });
  await expect(
    editLibraryPlexEditionV3(f.contextForEdit, f.input, bindingTestExecution()),
  ).rejects.toMatchObject({ code: "handoff_plex_edit_watch_changed" });
  expect(f.edit).toHaveBeenCalledTimes(1);
  expect(
    await cluster.database.mediaHandoffObservation.count({
      where: { planId: f.planId, kind: "plex_edit_completion_v1" },
    }),
  ).toBe(0);
});

test("a completed checkpoint and its original command are immutable", async () => {
  const f = await fixture();
  const completion = await editLibraryPlexEditionV3(
    f.contextForEdit,
    f.input,
    bindingTestExecution(),
  );
  await expect(
    cluster.database.mediaHandoffObservation.delete({
      where: { id: completion.id },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    cluster.database.operation.update({
      where: { id: f.input.operationId },
      data: { payload: { changed: true } },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    cluster.database.operation.update({
      where: { id: f.input.operationId },
      data: { status: "completed" },
    }),
  ).resolves.toMatchObject({ status: "completed" });
  expect(
    await editLibraryPlexEditionV3(
      f.contextForEdit,
      f.input,
      bindingTestExecution(),
    ),
  ).toEqual(completion);
});

test("an uncertain v3 edit also prevents a read-only v2 plan from owning the same file", async () => {
  const f = await fixture();
  let reads = 0;
  f.contextForEdit.plex.metadataForEditionEdit = () =>
    ++reads === 3
      ? Promise.reject(
          new Error("Synthetic readback unavailable after delivered edit"),
        )
      : Promise.resolve(f.item());
  await expect(
    editLibraryPlexEditionV3(f.contextForEdit, f.input, bindingTestExecution()),
  ).rejects.toThrow("readback unavailable");
  expect(f.item().editionTitle).toBe("Director's Cut");
  const scope = f.ready.prepared.scope;
  const {
    plexEditionLabels: _labels,
    schemaVersion: _version,
    ...request
  } = z
    .object({ plexEditionLabels: z.string(), schemaVersion: z.literal(3) })
    .loose()
    .parse(scope.request);
  const second = await f.commands.prepare(
    f.network.actor,
    crypto.randomUUID(),
    PrepareLibraryHandoffV2Schema.parse({ ...request, schemaVersion: 2 }),
  );
  const planId = z.uuid().parse(second.handoffId);
  const observe = () => createHandoffNetworkProducer(f.network.context)(planId);
  await observe();
  await finishHandoffPreparation(
    cluster.database,
    planId,
    await prepareHandoffFiles(f.context, planId),
  );
  const detail = await f.commands.detail(f.network.actor, planId);
  const applied = await f.commands.apply(
    f.network.actor,
    crypto.randomUUID(),
    planId,
    {
      schemaVersion: 2,
      expectedVersion: detail.version,
      planHash: z.string().parse(detail.planHash),
      recoveryEpoch: 0,
      runtimeVersion: 0,
      acknowledgeRecoveryHolds: true,
    },
  );
  await observe();
  await expect(
    applyPreparedHandoff(
      f.context,
      { planId, operationId: z.uuid().parse(applied.operationId) },
      await prepareHandoffFiles(f.context, planId),
    ),
  ).rejects.toThrow("remains uncertain");
  expect(
    await cluster.database.libraryAsset.findUnique({
      where: { path: f.target },
    }),
  ).toBeNull();
  f.contextForEdit.plex.metadataForEditionEdit = () =>
    Promise.resolve(f.item());
  await editLibraryPlexEditionV3(
    f.contextForEdit,
    f.input,
    bindingTestExecution(),
  );
  expect(f.edit).toHaveBeenCalledTimes(1);
});
