import { rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ForumStepAcknowledgementSchema,
  type ForumStepAcknowledgement,
} from "@shepherdjerred/ops-model/forum-recovery.ts";
import { SnapshotSourceSchema } from "./storage.ts";

const Step = z.enum([
  "install",
  "addons",
  "configure",
  "styles",
  "manual-jobs",
  "seed",
  "history",
  "accounts",
  "jobs",
]);
export const ForumReleaseJournalSchema = z.strictObject({
  schema: z.literal("storm-forum-release/v1"),
  stage: z.enum(["beta", "prod"]),
  owner: z.uuid(),
  candidate: SnapshotSourceSchema,
  original: SnapshotSourceSchema.nullable(),
  installationObserved: z.boolean(),
  originalSnapshot: z.string().nullable(),
  phase: z.enum([
    "prepared",
    "maintenance",
    "snapshot",
    "ready",
    "mutating",
    "verified",
    "complete",
  ]),
  step: Step.nullable(),
  completed: z.array(Step),
});
export type ForumReleaseJournal = z.infer<typeof ForumReleaseJournalSchema>;
export const FORUM_RELEASE_STEPS = Step.options;
const REPEATABLE = new Set<string>([
  "configure",
  "styles",
  "manual-jobs",
  "jobs",
]);

/** Operator acknowledgement proves one completed effect; it never retries it. */
export async function acknowledgeForumReleaseStep(
  file: string,
  journal: ForumReleaseJournal,
  raw: ForumStepAcknowledgement,
  verify: (step: ForumStepAcknowledgement["step"]) => Promise<void>,
): Promise<void> {
  const input = ForumStepAcknowledgementSchema.parse(raw);
  const before = await Bun.file(file).text();
  if (
    createHash("sha256").update(before).digest("hex") !== input.journalSha256 ||
    JSON.stringify(ForumReleaseJournalSchema.parse(JSON.parse(before))) !==
      JSON.stringify(ForumReleaseJournalSchema.parse(journal))
  )
    throw new Error("Forum acknowledgement journal bytes or identity changed");
  forumResumeStep({ ...journal, phase: "ready", step: null });
  if (
    journal.phase !== "mutating" ||
    journal.step !== input.step ||
    FORUM_RELEASE_STEPS[journal.completed.length] !== input.step
  )
    throw new Error(
      "Forum acknowledgement must name the exact interrupted step",
    );
  await verify(input.step);
  if ((await Bun.file(file).text()) !== before)
    throw new Error(
      "Forum journal changed during native completion inspection",
    );
  const completed: ForumReleaseJournal = {
    ...journal,
    completed: [...journal.completed, input.step],
    phase: "ready",
    step: null,
  };
  await writeForumReleaseJournal(file, completed);
  Object.assign(journal, completed);
}

/** Recreating the exact completed source Job is a read-only acknowledgement,
 * never a new owner or a replay of a database migration.
 */
export async function reuseCompletedForumRelease(
  input: {
    journal: ForumReleaseJournal;
    candidate: z.infer<typeof SnapshotSourceSchema>;
    stage: "beta" | "prod";
  },
  effects: { unlocked: () => Promise<boolean>; verify: () => Promise<void> },
): Promise<boolean> {
  const { journal, candidate, stage } = input;
  if (journal.phase !== "complete") return false;
  forumResumeStep(journal);
  if (
    journal.stage !== stage ||
    journal.candidate.runtimeImage !== candidate.runtimeImage ||
    journal.candidate.bundleSha256 !== candidate.bundleSha256 ||
    journal.candidate.xenforoVersion !== candidate.xenforoVersion
  )
    throw new Error(
      "Completed Forum journal belongs to another candidate or stage",
    );
  if (!(await effects.unlocked()))
    throw new Error(
      "Completed Forum journal still has native ownership markers",
    );
  await effects.verify();
  return true;
}

/** Only source-owned idempotent configuration/job-draining commands may repeat.
 * Interrupted installation, add-on and content/account migrations need native
 * manual inspection; neither a failed process nor a version string proves them safe.
 */
export function forumResumeStep(journal: ForumReleaseJournal): number {
  ForumReleaseJournalSchema.parse(journal);
  if (
    journal.completed.some((step, index) => step !== FORUM_RELEASE_STEPS[index])
  )
    throw new Error(
      "Forum release checkpoints are not an exact ordered prefix",
    );
  if (
    ["verified", "complete"].includes(journal.phase) &&
    journal.completed.length !== FORUM_RELEASE_STEPS.length
  )
    throw new Error("Forum terminal journal lacks every completed native step");
  if (journal.phase === "mutating" && !REPEATABLE.has(journal.step ?? ""))
    throw new Error(
      `Forum ${journal.step ?? "unknown"} may have partially mutated data; retain the original backup and maintenance owner for reviewed native repair`,
    );
  if (["prepared", "maintenance", "snapshot"].includes(journal.phase)) return 0;
  if (journal.original !== null && journal.originalSnapshot === null)
    throw new Error("Forum recovery has no committed original backup");
  if (!journal.installationObserved)
    throw new Error(
      "Forum recovery has not independently observed the original installation",
    );
  if (["verified", "complete"].includes(journal.phase))
    return FORUM_RELEASE_STEPS.length;
  if (
    journal.phase === "mutating" &&
    journal.step !== FORUM_RELEASE_STEPS[journal.completed.length]
  )
    throw new Error(
      "Forum release running step differs from its immutable checkpoint prefix",
    );
  return journal.completed.length;
}

export async function runForumReleaseSteps(
  journal: ForumReleaseJournal,
  execute: (step: (typeof FORUM_RELEASE_STEPS)[number]) => Promise<void>,
  checkpoint: (journal: ForumReleaseJournal) => Promise<void>,
): Promise<void> {
  const start = forumResumeStep(journal);
  for (const step of FORUM_RELEASE_STEPS.slice(start)) {
    journal.phase = "mutating";
    journal.step = step;
    await checkpoint(journal);
    await execute(step);
    journal.completed.push(step);
    journal.phase = "ready";
    journal.step = null;
    await checkpoint(journal);
  }
}

/** Atomic same-directory replacement; the immutable identity is checked on every checkpoint. */
export async function writeForumReleaseJournal(
  file: string,
  journal: ForumReleaseJournal,
): Promise<void> {
  const next = ForumReleaseJournalSchema.parse(journal);
  if (await Bun.file(file).exists()) {
    const prior = ForumReleaseJournalSchema.parse(await Bun.file(file).json());
    if (
      prior.owner !== next.owner ||
      prior.stage !== next.stage ||
      JSON.stringify(prior.candidate) !== JSON.stringify(next.candidate) ||
      (prior.original !== null &&
        JSON.stringify(prior.original) !== JSON.stringify(next.original)) ||
      (prior.originalSnapshot !== null &&
        prior.originalSnapshot !== next.originalSnapshot)
    )
      throw new Error(
        "Forum recovery cannot replace the original owner, candidate or committed backup",
      );
    if (
      prior.completed.some((step, index) => next.completed[index] !== step) ||
      (prior.installationObserved && !next.installationObserved)
    )
      throw new Error(
        "Forum recovery cannot discard native installation or step checkpoints",
      );
  }
  const temporary = `${file}.${next.owner}.tmp`;
  await Bun.write(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}
