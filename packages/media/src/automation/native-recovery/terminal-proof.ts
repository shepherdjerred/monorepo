import path from "node:path";
import { constants, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import type { ContentProof } from "#filesystem/content-proof.ts";
import type { JournalProof } from "#automation/handoff/journals.ts";
import type { NativePublishedScope } from "#shared/native-recovery/lifecycle.ts";
import {
  NativeTerminalEvidenceSchema,
  type NativeTerminalDescriptor,
} from "#shared/native-recovery/terminal.ts";
import { snapshotHash } from "#migration/profile-import.ts";

export function terminalDependencies(scope: NativePublishedScope) {
  return scope.schemaVersion === 2 ? scope.terminalDependencies : [];
}

export function terminalPaths(scope: NativePublishedScope) {
  return [
    ...terminalDependencies(scope).flatMap((item) =>
      item.files.map((file) => file.canonicalPath),
    ),
    ...(scope.schemaVersion === 2
      ? (scope.settledQuarantines ?? [])
      : []
    ).flatMap((item) => [
      ...item.participants.map((participant) => participant.quarantinePath),
      ...item.replacementFiles.map((file) => file.canonicalPath),
    ]),
  ];
}

/** Secondary bytes are dependencies only: this evidence grants no ownership or deletion authority. */
export type ProofInput = {
  scope: NativePublishedScope;
  content: ContentProof;
  journals: JournalProof[];
  resolvePath: (canonical: string) => string;
};
export async function terminalEvidence(input: ProofInput) {
  const result = [];
  for (const dependency of terminalDependencies(input.scope)) {
    const journalHashes = [];
    for (const expected of dependency.journals)
      journalHashes.push(await verifyTerminalJournal(input, expected));
    const files = [];
    for (const file of dependency.files)
      files.push(await terminalFileEvidence(input, file));
    result.push(
      NativeTerminalEvidenceSchema.parse({
        cleanupId: dependency.cleanupId,
        kind: dependency.kind,
        journalDigest: snapshotHash(journalHashes),
        files,
      }),
    );
  }
  return result;
}

export async function verifyTerminalJournal(
  input: Pick<ProofInput, "journals" | "resolvePath">,
  expected: NativeTerminalDescriptor["journals"][number],
) {
  const proof = input.journals
    .flatMap((journal) => journal.files)
    .find(
      (file) => path.basename(file.target) === `${expected.operationId}.json`,
    );
  if (proof === undefined)
    throw new Error("Native terminal journal is missing");
  const bytes = await readBoundedJournal(proof.target);
  if (
    bytes.length > 64 * 1024 ||
    createHash("sha256").update(bytes).digest("hex") !== proof.sha256
  )
    throw new Error("Native terminal journal changed");
  const actual = ManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
  const source =
    expected.kind === "import" &&
    !/^\/data\/(?:movies|tv)\//u.test(expected.source)
      ? expected.source
      : input.resolvePath(expected.source);
  if (
    actual.phase !== "complete" ||
    actual.operationId !== expected.operationId ||
    actual.kind !== expected.kind ||
    actual.source !== source ||
    actual.target !== input.resolvePath(expected.target) ||
    actual.sha256 !== expected.sha256 ||
    actual.previousSha256 !== expected.previousSha256
  )
    throw new Error(
      "Native terminal journal does not prove the recorded effect",
    );
  return {
    operationId: expected.operationId,
    sha256: proof.sha256,
  };
}

/** Provider retries may share a target; only the journal naming this exact subtitle source counts. */
export async function verifyInstallationJournal(
  input: Pick<ProofInput, "journals" | "resolvePath">,
  candidates: NativeTerminalDescriptor["journals"],
) {
  const matches = [];
  for (const expected of candidates) {
    const proof = input.journals
      .flatMap((journal) => journal.files)
      .find(
        (file) => path.basename(file.target) === `${expected.operationId}.json`,
      );
    if (proof === undefined) continue;
    const bytes = await readBoundedJournal(proof.target);
    const actual = ManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (actual.source === input.resolvePath(expected.source))
      matches.push(expected);
  }
  const match = matches[0];
  if (match === undefined || matches.length !== 1)
    throw new Error(
      "Native additional subtitle requires one exact installation journal",
    );
  return await verifyTerminalJournal(input, match);
}

export async function terminalFileEvidence(
  input: Pick<ProofInput, "content" | "resolvePath">,
  file: NativeTerminalDescriptor["files"][number],
) {
  const local = input.resolvePath(file.canonicalPath);
  const sha256 = await input.content.digest(local);
  if (sha256 !== file.expectedChecksum)
    throw new Error("Native terminal artifact contradicts the settled effect");
  const absence =
    sha256 === null ? await input.content.reviewAbsence(local) : null;
  return {
    canonicalPath: file.canonicalPath,
    sha256,
    identity:
      sha256 === null ? null : await input.content.reviewIdentity(local),
    absentAncestors: absence?.ancestors ?? [],
  };
}

async function readBoundedJournal(target: string) {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(64 * 1024 + 1);
    const { bytesRead } = await handle.read(bytes);
    if (bytesRead === bytes.length)
      throw new Error("Native terminal journal exceeds bound");
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
