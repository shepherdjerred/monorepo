import path from "node:path";
import { lstat, readFile, readdir } from "node:fs/promises";
import { z } from "zod";
import { PublicationEffectSchema } from "#shared/publication-proof/effects.ts";
import { safePath } from "#filesystem/operations-io.ts";
import {
  FileOperationConflict,
  type MediaFileRoots,
} from "#filesystem/operations-types.ts";
import {
  hashStableFile,
  requireFileIdentity,
  type VerifiedFileProof,
} from "#filesystem/verification.ts";
import { auditAncestors } from "./journal.ts";
import { ContentProof } from "#filesystem/content-proof.ts";

export function publicationRecordNamespace(input: {
  transitionId: string;
  continuationId: string | null;
}) {
  z.uuid().parse(input.transitionId);
  if (input.continuationId !== null) z.uuid().parse(input.continuationId);
  return `publication-transitions/${input.transitionId}/${input.continuationId === null ? "publication" : `compensation-${input.continuationId}`}`;
}

async function absentRecordNamespace(
  namespace: string,
  checkpoint: () => Promise<void>,
) {
  try {
    await lstat(namespace);
    return null;
  } catch (error) {
    if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
      throw error;
    const absent = new ContentProof();
    await absent.capture(namespace, checkpoint);
    absent.seal();
    await absent.reviewAbsence(namespace);
    return {
      records: [],
      assertUnchanged: async (added: readonly VerifiedFileProof[] = []) => {
        if (added.length > 0)
          throw new FileOperationConflict(
            "Absent historical namespace cannot acquire new records",
          );
        await absent.reviewAbsence(namespace);
      },
    };
  }
}

/** Read/hash actual durable records before PG. The returned final fence only stats saved identities. */
export async function inspectPublicationRecords(
  roots: MediaFileRoots,
  input: {
    transitionId: string;
    continuationId: string | null;
    maxRecords: number;
    maxRecordBytes: number;
    checkpoint: () => Promise<void>;
    allowAbsent?: boolean;
  },
) {
  const relative = publicationRecordNamespace(input);
  if (input.allowAbsent === true) {
    const absent = await absentRecordNamespace(
      path.join(roots.control, relative),
      input.checkpoint,
    );
    if (absent !== null) return absent;
  }
  const directory = path.dirname(
    await safePath(roots.control, `${relative}/record`, false),
  );
  const ancestors = await auditAncestors(path.join(directory, "record"));
  const names = await readdir(directory);
  names.sort();
  if (
    names.length > input.maxRecords * 2 ||
    names.some(
      (name) => !/^\d{8}\.json(?:\.[a-f0-9-]{36}\.pending)?$/u.test(name),
    )
  )
    throw new FileOperationConflict(
      "Publication record inventory is unknown or exceeds its plan",
    );
  const files = new Map<string, VerifiedFileProof>();
  const records = [];
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    await input.checkpoint();
    const filename = await safePath(
      roots.control,
      `${relative}/${name}`,
      false,
    );
    const stat = await lstat(filename, { bigint: true });
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > BigInt(input.maxRecordBytes)
    )
      throw new FileOperationConflict(
        "Publication record is not bounded regular content",
      );
    const identity = await hashStableFile(filename, input.checkpoint);
    const raw = await readFile(filename, "utf8");
    await requireFileIdentity(filename, identity);
    const record = PublicationEffectSchema.parse(JSON.parse(raw));
    if (
      JSON.stringify(record) !== raw ||
      record.transitionId !== input.transitionId ||
      record.continuationId !== input.continuationId ||
      name !== `${String(record.ordinal).padStart(8, "0")}.json`
    )
      throw new FileOperationConflict(
        "Publication record namespace or raw representation changed",
      );
    files.set(name, identity);
    records.push({ record, hash: identity.sha256 });
  }
  for (const name of names.filter((entry) => entry.endsWith(".pending"))) {
    const finalName = name.slice(0, 13);
    const final = files.get(finalName);
    const temporary = await lstat(path.join(directory, name), { bigint: true });
    if (
      final === undefined ||
      !temporary.isFile() ||
      temporary.isSymbolicLink() ||
      temporary.dev !== final.dev ||
      temporary.ino !== final.ino ||
      temporary.size !== BigInt(final.sizeBytes)
    )
      throw new FileOperationConflict(
        "Publication record has an unacknowledged temporary write",
      );
    files.set(name, { ...final, target: path.join(directory, name) });
  }
  const assertUnchanged = async (added: readonly VerifiedFileProof[] = []) => {
    const currentFiles = new Map(files);
    for (const proof of added) {
      if (
        path.dirname(proof.target) !== directory ||
        !/^\d{8}\.json$/u.test(path.basename(proof.target))
      )
        throw new FileOperationConflict(
          "Publication proof addition escapes its record directory",
        );
      currentFiles.set(path.basename(proof.target), proof);
    }
    const currentNames = await readdir(directory);
    if (
      JSON.stringify(await auditAncestors(path.join(directory, "record"))) !==
        JSON.stringify(ancestors) ||
      JSON.stringify(currentNames.sort()) !==
        JSON.stringify([...currentFiles.keys()].sort())
    )
      throw new FileOperationConflict(
        "Publication record inventory changed after verification",
      );
    for (const [name, identity] of currentFiles)
      await requireFileIdentity(path.join(directory, name), identity);
  };
  await assertUnchanged();
  return { records, assertUnchanged };
}
