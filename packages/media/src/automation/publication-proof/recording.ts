import type { FilePlanEntry } from "#automation/files/types.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { publicationRecordStore } from "#filesystem/publication-proof/store.ts";
import { inspectPublicationRecords } from "#filesystem/publication-proof/records.ts";
import { assertPublicationJournalIdentity } from "#filesystem/publication-proof/journal.ts";
import type { VerifiedFileProof } from "#filesystem/verification.ts";
import type { PublicationIOIntentRef } from "#shared/publication-proof/io.ts";
import type { PublicationEffect } from "#shared/publication-proof/effects.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  publicationReferences,
  observePublicationParticipants,
} from "./participants.ts";
import { physicalKey, effectHash } from "./effect-state.ts";
import { replayPublication } from "./replay.ts";
import {
  assertPublicationActive,
  type PublicationContext,
} from "./invocation.ts";
import { assertRecordedSubtitleDependencies } from "./subtitle-lineage.ts";
import {
  initializeMeasuredPublicationNamespace,
  type PublicationNamespaceMeasurement,
} from "#filesystem/publication-measurement.ts";
import type { MeasurementAuthority } from "#filesystem/content-measurement.ts";

/** Locked record phase: initialize measured namespaces without reading or hashing record bytes. */
export async function prepareMeasuredPublicationStores(
  context: PublicationContext,
  input: {
    transitionId: string;
    continuationId: string;
    plan: readonly FilePlanEntry[];
    measurements: readonly {
      kind: "movies" | "tv";
      measurement: PublicationNamespaceMeasurement;
    }[];
    authority: MeasurementAuthority;
  },
): Promise<PublicationStores> {
  assertPublicationActive(context);
  input.authority.assertActive();
  const kinds = [
    ...new Set(input.plan.map((entry) => entry.libraryKind)),
  ].sort();
  if (
    input.measurements.length !== kinds.length ||
    new Set(input.measurements.map((item) => item.kind)).size !==
      kinds.length ||
    input.measurements.some(
      ({ kind, measurement }) =>
        !kinds.includes(kind) ||
        measurement.binding.transitionId !== input.transitionId ||
        measurement.binding.continuationId !== input.continuationId ||
        JSON.stringify(measurement.roots) !==
          JSON.stringify(context.roots[kind]),
    )
  )
    throw new FileOperationConflict("Measured publication store scope changed");
  // Reject drift in any root before initializing the first root.
  await input.authority.assertCurrent();
  for (const { measurement } of input.measurements) {
    assertPublicationActive(context);
    input.authority.assertActive();
    await measurement.assertUnchanged();
    input.authority.assertActive();
  }
  const stores: PublicationStores = [];
  const invocationActive = () => {
    assertPublicationActive(context);
  };
  for (const kind of kinds) {
    const selected = input.measurements.find((item) => item.kind === kind);
    if (selected === undefined)
      throw new Error("Measured publication root missing");
    let boundAuthority = invocationActive;
    const currentActive = input.authority.assertActive;
    const guard = () => {
      assertPublicationActive(context);
      currentActive();
      boundAuthority();
    };
    const initialized = await initializeMeasuredPublicationNamespace(
      selected.measurement,
      {
        assertActive: guard,
        assertCurrent: input.authority.assertCurrent,
      },
    );
    const assertActive = initialized.assertActive;
    assertActive();
    stores.push({
      kind,
      store: initialized.store,
      observed: initialized.observed,
      added: [],
      assertActive,
      bindAuthority: (nextGuard) => {
        boundAuthority = nextGuard;
      },
    });
  }
  return stores;
}

export async function preparePublicationStores(
  context: PublicationContext,
  input: {
    transitionId: string;
    plan: readonly FilePlanEntry[];
    continuationId?: string | null;
  },
) {
  const proof = context.contentProof;
  if (proof === undefined)
    throw new FileOperationConflict(
      "Publication recording requires actual content proof",
    );
  const kinds = [
    ...new Set(input.plan.map((entry) => entry.libraryKind)),
  ].sort();
  const stores = [];
  for (const kind of kinds) {
    const roots = context.roots[kind];
    let assertActive = () => {
      assertPublicationActive(context);
    };
    const store = await publicationRecordStore(roots, {
      transitionId: input.transitionId,
      continuationId: input.continuationId ?? null,
      assertActive: () => {
        assertActive();
      },
      ...(context.verifyPlexExclusion === undefined
        ? {}
        : { verifyPlexExclusion: context.verifyPlexExclusion }),
    });
    const observed = await inspectPublicationRecords(roots, {
      transitionId: input.transitionId,
      continuationId: input.continuationId ?? null,
      maxRecords: input.plan.reduce(
        (sum, entry) => sum + 12 + entry.previousSidecars.length * 8,
        0,
      ),
      maxRecordBytes:
        Buffer.byteLength(JSON.stringify(publicationReferences(input.plan))) *
          64 +
        262_144,
      checkpoint: () => context.checkpoint("publication-record-verification"),
    });
    stores.push({
      kind,
      store,
      observed,
      added: new Array<VerifiedFileProof>(),
      assertActive: () => {
        assertActive();
      },
      bindAuthority: (guard: () => void) => {
        assertActive = guard;
      },
    });
  }
  return stores;
}

export type PublicationStores = Awaited<
  ReturnType<typeof preparePublicationStores>
>;

/** Process-local recorder composition; serialized records alone never instantiate filesystem authority. */
export function publicationRecording(
  context: PublicationContext,
  intent: PublicationIOIntentRef,
  stores: PublicationStores,
  options: {
    inverse?: { continuationId: string | null };
    acknowledged?: readonly PublicationEffect[];
  } = {},
) {
  const proof = context.contentProof;
  if (proof === undefined)
    throw new FileOperationConflict(
      "Publication recording lost its content proof",
    );
  const records = stores
    .flatMap(({ observed }) => observed.records)
    .sort((left, right) => left.record.ordinal - right.record.ordinal);
  for (const { record, hash } of records) {
    if (effectHash(record) !== hash)
      throw new FileOperationConflict(
        "Publication record hash differs from its durable bytes",
      );
  }
  const { state, actions } = replayPublication(
    context,
    intent,
    [...(options.acknowledged ?? []), ...records.map(({ record }) => record)],
    options.inverse,
  );
  const assertCurrent = async () => {
    assertPublicationActive(context);
    await assertRecordedSubtitleDependencies(context, proof, intent.intent);
    for (const item of intent.intent.entries) {
      const participants = await observePublicationParticipants(
        context,
        item.entry,
      );
      for (const participant of participants) {
        const expected = state.physical.get(
          physicalKey(participant.libraryKind, participant.physical),
        );
        if (
          expected === undefined ||
          snapshotHash(nativeJson(expected)) !==
            snapshotHash(nativeJson(participant.physical))
        )
          throw new FileOperationConflict(
            "Publication files differ from their acknowledged effect prefix",
          );
      }
    }
    for (const store of stores) {
      await store.observed.assertUnchanged(store.added);
      for (const journal of state.journals.values()) {
        if (
          state.journals.get(JSON.stringify([store.kind, journal.path])) ===
          journal
        )
          await assertPublicationJournalIdentity(
            context.roots[store.kind],
            journal,
          );
      }
    }
    for (const store of stores) store.assertActive();
  };
  const operations = (authorize: (entry: FilePlanEntry) => Promise<void>) =>
    stores.map((item) => ({
      kind: item.kind,
      files: new FileOperations(context.roots[item.kind], {
        contentProof: proof,
        checkpoint: context.checkpoint,
        ...(context.minimumFreeBytes === undefined
          ? {}
          : { minimumFreeBytes: context.minimumFreeBytes }),
        ...(context.verifyPlexExclusion === undefined
          ? {}
          : { verifyPlexExclusion: context.verifyPlexExclusion }),
        authorize: async (manifest) => {
          const entry = intent.intent.entries.find(
            ({ entry: candidate }) =>
              candidate.operationId === manifest.operationId ||
              `recover-${candidate.assetId}` === manifest.operationId ||
              candidate.previousSidecars.some(
                (sidecar) =>
                  sidecar.operationId === manifest.operationId ||
                  `recover-${sidecar.quarantineId}` === manifest.operationId,
              ),
          )?.entry;
          if (entry === undefined)
            throw new FileOperationConflict(
              "Publication operation is outside its exact plan",
            );
          await authorize(entry);
          await context.verifyStorageAuthority(context.roots[item.kind]);
        },
        effectRecorder: {
          assertActive: item.assertActive,
          acknowledge: async (event) => {
            const record = state.record(event);
            if (record.libraryKind !== item.kind)
              throw new FileOperationConflict(
                "Publication effect uses the wrong root",
              );
            state.validate(record);
            const saved = await item.store.append(record);
            item.added.push(saved.proof);
            state.accept(record);
            await context.checkpoint(`publication-effect-ack:${event.step}`);
          },
        },
      }),
    }));
  return { state, actions, assertCurrent, operations };
}

export async function withPublicationPaths<T>(
  context: PublicationContext,
  plan: readonly FilePlanEntry[],
  operations: readonly { kind: "movies" | "tv"; files: FileOperations }[],
  action: () => Promise<T>,
): Promise<T> {
  const lineages = [...(context.preparedSubtitleLineages?.values() ?? [])];
  const refs = [
    ...publicationReferences(plan),
    ...lineages.flatMap((item) => item.references),
    ...(context.publicationDependencies?.references ?? []),
  ];
  const enter = async (index: number): Promise<T> => {
    const item = operations[index];
    if (item === undefined) return await action();
    const entries = plan.filter((entry) => entry.libraryKind === item.kind);
    const ids = entries.flatMap((entry) => [
      entry.operationId,
      `recover-${entry.assetId}`,
      ...entry.previousSidecars.map((sidecar) => sidecar.operationId),
      ...entry.previousSidecars.map(
        (sidecar) => `recover-${sidecar.quarantineId}`,
      ),
    ]);
    ids.push(
      ...lineages
        .filter((lineage) => lineage.kind === item.kind)
        .flatMap((lineage) => lineage.operationIds),
    );
    ids.push(
      ...(context.publicationDependencies?.operations ?? [])
        .filter((operation) => operation.kind === item.kind)
        .map((operation) => operation.id),
    );
    await context.verifyStorageAuthority(context.roots[item.kind]);
    return await item.files.withContentPaths(
      [
        ...new Map(
          refs
            .filter((ref) => ref.libraryKind === item.kind)
            .map(({ root, path }) => [
              JSON.stringify([root, path]),
              { root, path },
            ]),
        ).values(),
      ],
      () => enter(index + 1),
      ids,
    );
  };
  return await enter(0);
}
