import path from "node:path";
import { constants, lstat, readdir, open } from "node:fs/promises";
import {
  FileOperationConflict,
  ManifestSchema,
} from "#filesystem/operations-types.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { PublicationJournal } from "#shared/publication-proof/effects.ts";
import {
  auditAncestors,
  assertPublicationJournalIdentity,
} from "#filesystem/publication-proof/journal.ts";
import type { FileContext } from "#automation/files/types.ts";
import { publicationReferences } from "./participants.ts";
import type { PublicationEffectState } from "./effect-state.ts";

async function inventory(directory: string) {
  const names = await readdir(directory);
  names.sort();
  if (
    names.length > 10_000 ||
    names.some((name) => !/^[\w-]+\.json$/u.test(name))
  )
    throw new FileOperationConflict(
      "Publication journal inventory is unknown or exceeds bound",
    );
  const result = new Map<string, string>();
  for (const name of names) {
    const stat = await lstat(path.join(directory, name), { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65_536n)
      throw new FileOperationConflict(
        "Publication journal is not bounded regular content",
      );
    result.set(
      name,
      JSON.stringify([
        String(stat.dev),
        String(stat.ino),
        String(stat.size),
        String(stat.mtimeNs),
        String(stat.ctimeNs),
      ]),
    );
  }
  return result;
}

/** Full bounded reads happen before PG. The final fence only lists/stats, including own ACKed replacements. */
export async function capturePublicationJournalSet(
  context: FileContext,
  state: PublicationEffectState,
) {
  const plan = state.intent.intent.entries.map((item) => item.entry);
  const references = publicationReferences(plan);
  const result = [];
  for (const kind of [
    ...new Set(plan.map((entry) => entry.libraryKind)),
  ].sort()) {
    const roots = context.roots[kind];
    const directory = path.join(roots.control, "journal");
    const ancestors = await auditAncestors(path.join(directory, "entry"));
    const before = await inventory(directory);
    const targets = new Set(
      references
        .filter((item) => item.libraryKind === kind)
        .map((item) => path.join(roots[item.root], item.path)),
    );
    const known = [...state.journals].filter(([key]) =>
      key.startsWith(JSON.stringify([kind]).slice(0, -1) + ","),
    );
    const digest = await captureJournalDigest(
      directory,
      before,
      targets,
      known.map(([, journal]) => journal),
    );
    if (
      JSON.stringify([...before]) !==
      JSON.stringify([...(await inventory(directory))])
    )
      throw new FileOperationConflict(
        "Publication journal set changed during capture",
      );
    for (const [, journal] of known)
      await assertPublicationJournalIdentity(roots, journal);
    const assertCurrent = async (current: PublicationEffectState) => {
      if (
        JSON.stringify(await auditAncestors(path.join(directory, "entry"))) !==
        JSON.stringify(ancestors)
      )
        throw new FileOperationConflict(
          "Publication journal directory or ancestor changed",
        );
      const actual = await inventory(directory);
      const owned = new Map(
        [...current.journals]
          .filter(([key]) =>
            key.startsWith(JSON.stringify([kind]).slice(0, -1) + ","),
          )
          .map(([, value]) => [path.basename(value.path), value]),
      );
      for (const [name, identity] of before)
        if (!owned.has(name) && actual.get(name) !== identity)
          throw new FileOperationConflict(
            "Unrelated publication journal changed",
          );
      for (const name of actual.keys())
        if (!before.has(name) && !owned.has(name))
          throw new FileOperationConflict(
            "Unacknowledged publication journal appeared",
          );
      for (const journal of owned.values())
        await assertPublicationJournalIdentity(roots, journal);
    };
    result.push({ kind, digest, assertCurrent });
  }
  return result;
}

/** Publication's birth import may still be staged while an earlier sidecar ACK exists. */
async function captureJournalDigest(
  directory: string,
  entries: ReadonlyMap<string, string>,
  targets: ReadonlySet<string>,
  known: readonly PublicationJournal[],
) {
  const historical = [];
  for (const name of entries.keys()) {
    const filename = path.join(directory, name);
    const raw = await readBoundedJournal(filename);
    const manifest = ManifestSchema.parse(JSON.parse(raw));
    if (!targets.has(manifest.source) && !targets.has(manifest.target))
      continue;
    const expected = known.find((item) => path.basename(item.path) === name);
    if (expected === undefined && manifest.phase !== "complete")
      throw new FileOperationConflict(
        "Publication has an unacknowledged unfinished journal",
      );
    if (expected !== undefined && raw !== expected.raw)
      throw new FileOperationConflict(
        "Publication acknowledged journal bytes changed",
      );
    if (expected === undefined) historical.push(manifest);
  }
  return snapshotHash(
    historical.sort((left, right) =>
      left.operationId.localeCompare(right.operationId),
    ),
  );
}

async function readBoundedJournal(filename: string): Promise<string> {
  const handle = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > 65_536n)
      throw new FileOperationConflict(
        "Publication journal exceeds its read bound",
      );
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const named = await lstat(filename, { bigint: true });
    if (
      BigInt(offset) !== before.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      named.dev !== before.dev ||
      named.ino !== before.ino
    )
      throw new FileOperationConflict(
        "Publication journal changed during bounded read",
      );
    const raw = bytes.subarray(0, offset).toString("utf8");
    if (Buffer.byteLength(raw) !== offset)
      throw new FileOperationConflict("Publication journal encoding changed");
    return raw;
  } finally {
    await handle.close();
  }
}
