import { createHash } from "node:crypto";
import {
  constants,
  lstat,
  mkdtemp,
  open,
  readFile,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { z } from "zod";
import { withAdvisoryLock } from "./advisory-lock.ts";
import {
  ProbeJournalSchema,
  readProbeJournal,
  saveProbeJournal,
  type ProbeJournal,
  type ProbeFileIdentity,
} from "./plex-exclusion-state.ts";
import { exists, safePath, syncDirectory } from "./operations-io.ts";
import {
  inspectMedia,
  runMediaTool,
  type RunMediaTool,
} from "./media-tools.ts";
import {
  PlexExclusionPlanSchema,
  type PlexExclusionPlan,
} from "#shared/plex-exclusion.ts";

function textDigest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

type ProbeGuard = {
  authorize: () => Promise<void>;
  save: (journal: ProbeJournal) => Promise<void>;
  checkpoint: () => Promise<void>;
};

/** Real valid video, prepared outside the scanned library before operator approval. */
export async function prepareProbeVideo(
  runId: string,
  run: RunMediaTool = runMediaTool,
): Promise<ProbeJournal> {
  z.uuid().parse(runId);
  const directory = await mkdtemp(nodePath.join(tmpdir(), "media-exclusion-"));
  const path = nodePath.join(directory, "probe.mkv");
  try {
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x240:r=1",
        "-t",
        "2",
        "-c:v",
        "mpeg4",
        "-metadata",
        `title=Media Exclusion ${runId}`,
        "-f",
        "matroska",
        path,
      ],
      { maxBytes: 1024, timeoutMs: 30_000 },
    );
    const probe = await inspectMedia(path, { run });
    if (Number(probe.format.size) > 2 * 1024 * 1024)
      throw new Error("Probe video exceeded byte bound");
    const video = await readFile(path);
    return ProbeJournalSchema.parse({
      videoBase64: video.toString("base64"),
      probeSha256: textDigest(video),
      markersCompleted: false,
      positiveIntent: false,
      negativeIntent: false,
      positive: null,
      negative: null,
      stagedAt: null,
      cleanedAt: null,
      positiveRemoved: false,
      negativeRemoved: false,
    });
  } finally {
    if (await exists(path)) await unlink(path);
    await rmdir(directory);
  }
}

/** Read-only preparation never creates the control directory or markers. */
export async function readExclusionMarkers(libraryRoot: string): Promise<{
  rootMarkerBefore: string | null;
  controlMarkerBefore: string | null;
}> {
  const rootMarker = await safePath(libraryRoot, ".plexignore", false);
  const controlPath = nodePath.join(libraryRoot, ".media-control");
  if (await exists(controlPath)) {
    const info = await lstat(controlPath);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Unsafe control directory");
  }
  return {
    rootMarkerBefore: await readMarker(rootMarker),
    controlMarkerBefore: (await exists(controlPath))
      ? await readMarker(await safePath(controlPath, ".plexignore", false))
      : null,
  };
}

export async function stageExclusionProbe(
  rawPlan: PlexExclusionPlan,
  rawJournal: ProbeJournal,
  guard: ProbeGuard,
): Promise<ProbeJournal> {
  const plan = PlexExclusionPlanSchema.parse(rawPlan);
  let journal = ProbeJournalSchema.parse(rawJournal);
  const bytes = Buffer.from(journal.videoBase64, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > 2 * 1024 * 1024 ||
    textDigest(bytes) !== journal.probeSha256
  )
    throw new Error("Probe artifact changed");
  await guard.authorize();
  const lock = await safePath(
    plan.libraryRoot,
    ".media-control/exclusion.lock",
    true,
  );
  return await withAdvisoryLock(lock, async (assertHeld) => {
    const authorize = async () => {
      assertHeld();
      await guard.checkpoint();
      await guard.authorize();
      assertHeld();
    };
    await authorize();
    journal = await readProbeJournal(plan, journal);
    const save = async () => {
      await saveProbeJournal(plan, journal);
      await guard.save(journal);
    };
    await save();
    if (journal.cleanedAt !== null) throw new Error("Probe already cleaned");
    if (!journal.markersCompleted) {
      await replaceMarker(
        {
          root: plan.libraryRoot,
          before: plan.rootMarkerBefore,
          after: plan.rootMarkerAfter,
        },
        authorize,
      );
      await replaceMarker(
        {
          root: plan.controlRoot,
          before: plan.controlMarkerBefore,
          after: plan.controlMarkerAfter,
        },
        authorize,
      );
      journal = { ...journal, markersCompleted: true };
      await save();
    }
    await requireMarkers(plan);
    for (const kind of ["positive", "negative"] as const) {
      const path = kind === "positive" ? plan.positivePath : plan.negativePath;
      const relative = nodePath.relative(plan.libraryRoot, path);
      const target = await safePath(plan.libraryRoot, relative, true);
      const intent = kind === "positive" ? "positiveIntent" : "negativeIntent";
      if (!journal[intent]) {
        if (await exists(target))
          throw new Error("Probe target already exists");
        journal = { ...journal, [intent]: true };
        await save();
      }
      await authorize();
      if (!(await exists(target))) {
        const handle = await open(
          target,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            constants.O_NOFOLLOW,
          0o644,
        );
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await syncDirectory(nodePath.dirname(target));
      }
      const identity = await identityOf(target, journal.probeSha256);
      requireSameIdentity(journal[kind], identity);
      journal = { ...journal, [kind]: identity };
      await save();
    }
    journal = {
      ...journal,
      stagedAt: journal.stagedAt ?? new Date().toISOString(),
    };
    await save();
    assertHeld();
    return journal;
  });
}

/** Deletes only exact journal-owned probes; a merged Plex record is never deleted here. */
export async function cleanupExclusionProbe(
  rawPlan: PlexExclusionPlan,
  rawJournal: ProbeJournal,
  guard: ProbeGuard,
): Promise<ProbeJournal> {
  const plan = PlexExclusionPlanSchema.parse(rawPlan);
  let journal = ProbeJournalSchema.parse(rawJournal);
  await guard.authorize();
  const lock = await safePath(
    plan.libraryRoot,
    ".media-control/exclusion.lock",
    false,
  );
  return await withAdvisoryLock(lock, async (assertHeld) => {
    journal = await readProbeJournal(plan, journal);
    for (const kind of ["positive", "negative"] as const) {
      journal = await removeProbe(journal, { plan, kind, guard, assertHeld });
      journal = {
        ...journal,
        [kind === "positive" ? "positiveRemoved" : "negativeRemoved"]: true,
      };
      await saveProbeJournal(plan, journal);
      await guard.save(journal);
    }
    journal = {
      ...journal,
      cleanedAt: journal.cleanedAt ?? new Date().toISOString(),
    };
    await saveProbeJournal(plan, journal);
    await guard.save(journal);
    assertHeld();
    return journal;
  });
}

async function removeProbe(
  journal: ProbeJournal,
  input: {
    plan: PlexExclusionPlan;
    kind: "positive" | "negative";
    guard: ProbeGuard;
    assertHeld: () => void;
  },
): Promise<ProbeJournal> {
  const { plan, kind, guard, assertHeld } = input;
  const path = kind === "positive" ? plan.positivePath : plan.negativePath;
  if (!(await exists(path))) return journal;
  const target = await safePath(
    plan.libraryRoot,
    nodePath.relative(plan.libraryRoot, path),
    false,
  );
  const actual = await identityOf(target, journal.probeSha256);
  let identity = journal[kind];
  if (identity === null) {
    const intent =
      kind === "positive" ? journal.positiveIntent : journal.negativeIntent;
    if (!intent) throw new Error("Probe ownership journal is incomplete");
    identity = actual;
    journal = { ...journal, [kind]: identity };
    await saveProbeJournal(plan, journal);
    await guard.save(journal);
  }
  requireSameIdentity(identity, actual);
  assertHeld();
  await guard.checkpoint();
  await guard.authorize();
  assertHeld();
  const final = await lstat(target, { bigint: true });
  if (
    String(final.dev) !== identity.dev ||
    String(final.ino) !== identity.ino ||
    Number(final.size) !== identity.size ||
    String(final.mtimeNs) !== identity.mtimeNs ||
    String(final.ctimeNs) !== identity.ctimeNs
  )
    throw new Error("Probe cleanup identity changed");
  await unlink(target);
  await syncDirectory(nodePath.dirname(target));
  return journal;
}

export async function requireMarkers(plan: PlexExclusionPlan): Promise<void> {
  if (
    (await readMarker(
      await safePath(plan.libraryRoot, ".plexignore", false),
    )) !== plan.rootMarkerAfter ||
    (await readMarker(
      await safePath(plan.controlRoot, ".plexignore", false),
    )) !== plan.controlMarkerAfter
  )
    throw new Error("Plex exclusion markers changed");
}

async function readMarker(path: string): Promise<string | null> {
  if (!(await exists(path))) return null;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 64 * 1024)
      throw new Error("Unsafe Plex exclusion marker");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await handle.readFile(),
    );
  } finally {
    await handle.close();
  }
}

async function replaceMarker(
  input: { root: string; before: string | null; after: string },
  authorize: () => Promise<void>,
): Promise<void> {
  const { root, before, after } = input;
  const path = await safePath(root, ".plexignore", false);
  const current = await readMarker(path);
  if (current === after) return;
  if (current !== before)
    throw new Error("Plex marker changed since preparation");
  const temporary = `${path}.media-exclusion-pending`;
  if (await exists(temporary))
    throw new Error("Unsettled Plex marker write needs reconciliation");
  await authorize();
  const handle = await open(
    temporary,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o644,
  );
  try {
    await handle.writeFile(after);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await authorize();
  if ((await readMarker(path)) !== before)
    throw new Error("Plex marker changed before publication");
  await rename(temporary, path);
  await syncDirectory(root);
}

function requireSameIdentity(
  previous: ProbeFileIdentity | null,
  current: ProbeFileIdentity,
): void {
  if (previous !== null && JSON.stringify(previous) !== JSON.stringify(current))
    throw new Error("Probe file identity changed");
}

async function identityOf(
  path: string,
  sha256: string,
): Promise<ProbeFileIdentity> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.size <= 0n ||
      before.size > 2n * 1024n * 1024n
    )
      throw new Error("Unsafe probe file");
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      before.size !== after.size ||
      textDigest(bytes) !== sha256
    )
      throw new Error("Probe content changed");
    return {
      dev: String(after.dev),
      ino: String(after.ino),
      mtimeNs: String(after.mtimeNs),
      ctimeNs: String(after.ctimeNs),
      size: Number(after.size),
      sha256,
    };
  } finally {
    await handle.close();
  }
}
