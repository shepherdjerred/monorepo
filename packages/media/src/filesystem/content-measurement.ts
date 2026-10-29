import { ContentProof } from "./content-proof.ts";
import {
  safePath,
  validateMediaRoots,
  verifyControlExclusion,
} from "./operations-io.ts";
import {
  FileOperationConflict,
  type MediaFileRoots,
} from "./operations-types.ts";

export type MeasurementAuthority = {
  assertActive: () => void;
  /** Full current authority and configured-root checks supplied by the locked caller. */
  assertCurrent: () => Promise<void>;
};
export type MeasurementClock = {
  assertActive: () => void;
  checkpoint: () => Promise<void>;
  verifyPlexExclusion?: (roots: MediaFileRoots) => Promise<void>;
};
export type MeasurementPath = { root: "library" | "control"; path: string };

/** Opaque prelock measurements. No mutation methods or effect-capable context escape. */
export async function captureContentMeasurement(
  roots: MediaFileRoots,
  references: readonly MeasurementPath[],
  clock: MeasurementClock,
) {
  const originalActive = clock.assertActive;
  const originalCheckpoint = clock.checkpoint;
  const verifier = clock.verifyPlexExclusion;
  originalActive();
  validateMediaRoots(roots, verifier !== undefined);
  if (references.length === 0 || references.length > 10_000)
    throw new FileOperationConflict("Content measurement scope is not bounded");
  const configured = { ...roots };
  const proof = new ContentProof();
  const paths = new Map<string, string>();
  const active = () => {
    originalActive();
    if (JSON.stringify(roots) !== JSON.stringify(configured))
      throw new FileOperationConflict("Measured roots changed");
  };
  const checkpoint = async () => {
    active();
    await originalCheckpoint();
    active();
  };
  // Resolve the entire bounded set before reading any media content.
  for (const ref of references) {
    active();
    const filename = await safePath(configured[ref.root], ref.path, false);
    active();
    paths.set(JSON.stringify(ref), filename);
  }
  await verifyControlExclusion(configured, verifier);
  active();
  for (const filename of paths.values()) {
    await proof.capture(filename, checkpoint);
    active();
  }
  const assertUnchanged = async () => {
    active();
    await verifyControlExclusion(configured, verifier);
    active();
    for (const filename of paths.values()) {
      await proof.reviewCaptured(filename);
      active();
    }
  };
  return Object.freeze({
    async inspect(reference: MeasurementPath) {
      active();
      const filename = paths.get(JSON.stringify(reference));
      if (filename === undefined)
        throw new FileOperationConflict("Path is outside measured scope");
      const facts = await proof.reviewCaptured(filename);
      active();
      return facts;
    },
    assertUnchanged,
    async seal(authority: MeasurementAuthority) {
      const currentActive = authority.assertActive;
      active();
      currentActive();
      await authority.assertCurrent();
      active();
      currentActive();
      await assertUnchanged();
      currentActive();
      proof.sealMeasured(() => {
        active();
        currentActive();
      });
      return proof;
    },
  });
}
