import { z } from "zod";

const MIGRATION_NOTE_PREFIX = "temporal-namespace-migration:v1:";
export const SOURCE_MIGRATION_NOTE =
  "Migrated to environment-scoped Temporal namespace";

export type MigrationState = {
  sourcePaused: boolean;
  sourceNote: string | undefined;
  attemptedAt?: string;
  cutoverAt?: string;
};

const MigrationStateSchema = z.object({
  sourcePaused: z.boolean(),
  sourceNote: z.string().optional(),
  attemptedAt: z.iso.datetime().optional(),
  cutoverAt: z.iso.datetime().optional(),
});

export function encodeMigrationState(state: MigrationState): string {
  return `${MIGRATION_NOTE_PREFIX}${Buffer.from(JSON.stringify(state)).toString("base64url")}`;
}

export function decodeMigrationState(note: string | undefined): MigrationState {
  if (note?.startsWith(MIGRATION_NOTE_PREFIX) !== true) {
    throw new Error("Target schedule is missing migration state");
  }
  const encoded = note.slice(MIGRATION_NOTE_PREFIX.length);
  const state = MigrationStateSchema.parse(
    JSON.parse(Buffer.from(encoded, "base64url").toString()) as unknown,
  );
  return {
    sourcePaused: state.sourcePaused,
    sourceNote: state.sourceNote,
    ...(state.attemptedAt === undefined
      ? {}
      : { attemptedAt: state.attemptedAt }),
    ...(state.cutoverAt === undefined ? {} : { cutoverAt: state.cutoverAt }),
  };
}

export function sourceStateAllowsCutover(
  current: { paused: boolean; note?: string },
  prepared: MigrationState,
): boolean {
  return (
    (current.note === SOURCE_MIGRATION_NOTE && current.paused) ||
    (current.note === prepared.sourceNote &&
      current.paused === prepared.sourcePaused)
  );
}

export function targetPauseAction(
  currentPaused: boolean,
  prepared: MigrationState,
): "pause" | "unpause" | undefined {
  if (!currentPaused && prepared.sourcePaused) return "pause";
  if (currentPaused && !prepared.sourcePaused) return "unpause";
  return undefined;
}

export function cutoverTimestampForRetry(
  targets: readonly { migrationState: MigrationState }[],
  now: Date,
): Date {
  let persisted: string | undefined;
  for (const { migrationState } of targets) {
    const boundary = migrationState.cutoverAt ?? migrationState.attemptedAt;
    if (boundary === undefined) continue;
    if (persisted !== undefined && persisted !== boundary) {
      throw new Error("Prepared targets disagree about the cutover boundary");
    }
    persisted = boundary;
  }
  return persisted === undefined ? now : new Date(persisted);
}

export function migrationAuditQueries(cutoverAt: Date): {
  open: string;
  startedAfterCutover: string;
} {
  return {
    open: 'ExecutionStatus = "Running"',
    startedAfterCutover: `StartTime >= "${cutoverAt.toISOString()}"`,
  };
}
