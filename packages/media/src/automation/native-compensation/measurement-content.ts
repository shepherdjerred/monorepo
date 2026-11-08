import type { ContentReference } from "#automation/files/content-proof.ts";
import type { FilePlanEntry } from "#automation/files/types.ts";
import { publicationParticipants } from "#automation/publication-proof/participants.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import type { MeasurementAuthority } from "#filesystem/content-measurement.ts";
import {
  safePath,
  validateMediaRoots,
  verifyControlExclusion,
} from "#filesystem/operations-io.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { PhysicalPathStateSchema } from "#shared/publication-proof/effects.ts";
import type { PublicationParticipant } from "#shared/publication-proof/intent.ts";
import type { CompensationFileContext } from "./execution.ts";

/** One private, unsealed measurement spans every configured root in the descriptor. */
export async function measureCompensationContent(
  context: CompensationFileContext,
  references: readonly ContentReference[],
  assertActive: () => void,
) {
  if (references.length === 0 || references.length > 10_000)
    throw new FileOperationConflict("Compensation measurement is not bounded");
  const configured = structuredClone(context.files.roots);
  const active = () => {
    assertActive();
    if (JSON.stringify(context.files.roots) !== JSON.stringify(configured))
      throw new FileOperationConflict("Compensation measurement roots changed");
  };
  const kinds = [...new Set(references.map((item) => item.libraryKind))].sort();
  for (const kind of kinds)
    validateMediaRoots(
      configured[kind],
      context.files.verifyPlexExclusion !== undefined,
    );
  const paths = new Map<string, string>();
  // Validate the COMPLETE set before the first content read. No parent creation.
  for (const reference of references) {
    active();
    const filename = await safePath(
      configured[reference.libraryKind][reference.root],
      reference.path,
      false,
    );
    active();
    paths.set(JSON.stringify(reference), filename);
  }
  for (const kind of kinds) {
    await verifyControlExclusion(
      configured[kind],
      context.files.verifyPlexExclusion,
    );
    active();
  }
  const proof = new ContentProof();
  for (const filename of paths.values()) {
    await proof.capture(filename, async () => {
      active();
      await context.files.checkpoint("content-proof-hashing");
      active();
    });
    active();
  }
  const inspect = async (reference: ContentReference) => {
    active();
    const filename = paths.get(JSON.stringify(reference));
    if (filename === undefined)
      throw new FileOperationConflict("Compensation path was not measured");
    const facts = await proof.reviewCaptured(filename);
    active();
    return facts;
  };
  const assertUnchanged = async () => {
    for (const reference of references) await inspect(reference);
    active();
  };
  return Object.freeze({
    assertUnchanged,
    async participants(plan: readonly FilePlanEntry[]) {
      const result: PublicationParticipant[] = [];
      for (const entry of plan)
        for (const item of publicationParticipants(entry)) {
          const { file, ancestors } = await inspect({
            libraryKind: item.libraryKind,
            root: item.root,
            path: item.path,
          });
          const physical = PhysicalPathStateSchema.parse(
            file === null
              ? {
                  root: item.root,
                  path: item.path,
                  state: "absent",
                  ancestors,
                }
              : {
                  root: item.root,
                  path: item.path,
                  state: "present",
                  sha256: file.sha256,
                  sizeBytes: file.sizeBytes,
                  identity: {
                    device: String(file.dev),
                    inode: String(file.ino),
                    mtimeNs: String(file.mtimeNs),
                    ctimeNs: String(file.ctimeNs),
                    ancestors,
                  },
                },
          );
          result.push({
            assetId: item.assetId,
            subtitleId: item.subtitleId,
            libraryKind: item.libraryKind,
            role: item.role,
            physical,
          });
        }
      return result;
    },
    async seal(authority: MeasurementAuthority) {
      active();
      authority.assertActive();
      await authority.assertCurrent();
      active();
      authority.assertActive();
      await assertUnchanged();
      authority.assertActive();
      const currentActive = authority.assertActive;
      proof.sealMeasured(() => {
        active();
        currentActive();
      });
      return proof;
    },
  });
}
