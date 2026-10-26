import path from "node:path";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { z } from "zod";
import {
  publicationRecordNamespace,
  inspectPublicationRecords,
} from "./publication-proof/records.ts";
import { openMeasuredPublicationRecordStore } from "./publication-proof/store.ts";
import { auditAncestors } from "./publication-proof/journal.ts";
import {
  syncDirectory,
  validateMediaRoots,
  verifyControlExclusion,
} from "./operations-io.ts";
import {
  FileOperationConflict,
  type MediaFileRoots,
} from "./operations-types.ts";
import { requireFileIdentity, type VerifiedFileProof } from "./verification.ts";
import type { PublicationEffect } from "#shared/publication-proof/effects.ts";
import type {
  MeasurementAuthority,
  MeasurementClock,
} from "./content-measurement.ts";

type NamespaceInput = MeasurementClock & {
  transitionId: string;
  continuationId: string;
  maxRecords: number;
  maxRecordBytes: number;
};
const missing = z.object({ code: z.literal("ENOENT") });
type InitializedNamespace = {
  store: Awaited<ReturnType<typeof openMeasuredPublicationRecordStore>>;
  observed: Awaited<ReturnType<typeof inspectPublicationRecords>>;
  assertActive: () => void;
};
const initializers = new WeakMap<
  object,
  (authority: MeasurementAuthority) => Promise<InitializedNamespace>
>();

async function directoryIdentity(directory: string) {
  try {
    const info = await lstat(directory, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new FileOperationConflict(
        "Measured namespace is not a real directory",
      );
    return { device: String(info.dev), inode: String(info.ino) };
  } catch (error) {
    if (missing.safeParse(error).success) return null;
    throw error;
  }
}

/** Prelock record hashing. Missing current namespaces remain absent until full authority. */
export async function measurePublicationNamespace(
  roots: MediaFileRoots,
  input: NamespaceInput,
) {
  const configured = { ...roots };
  const originalActive = input.assertActive;
  const checkpoint = input.checkpoint;
  const verifier = input.verifyPlexExclusion;
  const binding = Object.freeze({
    transitionId: input.transitionId,
    continuationId: input.continuationId,
  });
  const active = () => {
    originalActive();
    if (JSON.stringify(roots) !== JSON.stringify(configured))
      throw new FileOperationConflict("Measured namespace roots changed");
  };
  active();
  validateMediaRoots(configured, verifier !== undefined);
  const relative = publicationRecordNamespace(binding);
  if (
    !Number.isSafeInteger(input.maxRecords) ||
    input.maxRecords < 1 ||
    input.maxRecords > 10_000 ||
    !Number.isSafeInteger(input.maxRecordBytes) ||
    input.maxRecordBytes < 1 ||
    input.maxRecordBytes > 16_777_216
  )
    throw new FileOperationConflict("Record measurement bounds are invalid");
  const root = await realpath(configured.control);
  active();
  if (root !== configured.control)
    throw new FileOperationConflict("Measured control root is aliased");
  const directory = path.join(root, relative);
  // The original publication namespace establishes these parents. Never create them here.
  const parents = await auditAncestors(directory);
  active();
  const initial = await directoryIdentity(directory);
  active();
  await verifyControlExclusion(configured, verifier);
  active();
  const observed =
    initial === null
      ? null
      : await inspectPublicationRecords(configured, {
          ...binding,
          maxRecords: input.maxRecords,
          maxRecordBytes: input.maxRecordBytes,
          checkpoint: async () => {
            active();
            await checkpoint();
            active();
          },
        });
  active();
  let initialized = false;
  const assertParents = async () => {
    active();
    const currentParents = await auditAncestors(directory);
    active();
    if (JSON.stringify(currentParents) !== JSON.stringify(parents))
      throw new FileOperationConflict("Measured namespace parent changed");
  };
  const assertUnchanged = async () => {
    await assertParents();
    const current = await directoryIdentity(directory);
    active();
    if (JSON.stringify(current) !== JSON.stringify(initial))
      throw new FileOperationConflict("Measured namespace identity changed");
    if (observed !== null) await observed.assertUnchanged();
    active();
  };
  await assertUnchanged();
  const measurement = Object.freeze({
    binding,
    roots: Object.freeze(configured),
    get records() {
      return structuredClone(observed?.records ?? []);
    },
    assertUnchanged,
  });
  initializers.set(measurement, async (authority) => {
    const currentActive = authority.assertActive;
    const guard = () => {
      active();
      currentActive();
    };
    guard();
    if (initialized)
      throw new FileOperationConflict("Namespace measurement already consumed");
    await authority.assertCurrent();
    guard();
    await assertUnchanged();
    guard();
    await verifyControlExclusion(configured, verifier);
    guard();
    let finalObservation = observed;
    if (initial === null) {
      // Exclusive creation: an EEXIST race is never adopted as our own transition.
      guard();
      await mkdir(directory);
      guard();
      await assertParents();
      guard();
      await syncDirectory(path.dirname(directory), guard);
      guard();
      finalObservation = await emptyNamespaceObservation(directory, guard);
      guard();
    }
    if (finalObservation === null)
      throw new Error("Measured record observation missing");
    await finalObservation.assertUnchanged();
    guard();
    await assertParents();
    guard();
    const ancestors = await auditAncestors(path.join(directory, "record"));
    guard();
    const store = await openMeasuredPublicationRecordStore(configured, {
      ...binding,
      assertActive: guard,
      namespace: {
        directory,
        ancestors,
        assertUnchanged: finalObservation.assertUnchanged,
      },
      ...(verifier === undefined ? {} : { verifyPlexExclusion: verifier }),
    });
    guard();
    await finalObservation.assertUnchanged();
    guard();
    initialized = true;
    return { store, observed: finalObservation, assertActive: guard };
  });
  return measurement;
}

/** Explicit effect boundary: only actual measured instances and mandatory full authority are accepted. */
export function initializeMeasuredPublicationNamespace(
  measurement: PublicationNamespaceMeasurement,
  authority: MeasurementAuthority,
): Promise<InitializedNamespace> {
  const initialize = initializers.get(measurement);
  if (initialize === undefined)
    throw new FileOperationConflict(
      "Record namespace lacks its actual measurement",
    );
  return initialize(authority);
}

/** Actual own empty-directory identity, then only stat checks of its own acknowledged additions. */
async function emptyNamespaceObservation(
  directory: string,
  assertActive: () => void,
) {
  assertActive();
  const ancestors = await auditAncestors(path.join(directory, "record"));
  assertActive();
  const assertUnchanged = async (added: readonly VerifiedFileProof[] = []) => {
    assertActive();
    const current = await auditAncestors(path.join(directory, "record"));
    assertActive();
    const names = await readdir(directory);
    assertActive();
    if (
      JSON.stringify(current) !== JSON.stringify(ancestors) ||
      added.some(
        (proof) =>
          path.dirname(proof.target) !== directory ||
          !/^\d{8}\.json$/u.test(path.basename(proof.target)),
      ) ||
      JSON.stringify(names.sort()) !==
        JSON.stringify(added.map((proof) => path.basename(proof.target)).sort())
    )
      throw new FileOperationConflict(
        "Initialized namespace is not the exact empty transition",
      );
    for (const proof of added) {
      await requireFileIdentity(proof.target, proof);
      assertActive();
    }
  };
  await assertUnchanged();
  return {
    records: new Array<{ record: PublicationEffect; hash: string }>(),
    assertUnchanged,
  };
}

export type PublicationNamespaceMeasurement = Awaited<
  ReturnType<typeof measurePublicationNamespace>
>;
