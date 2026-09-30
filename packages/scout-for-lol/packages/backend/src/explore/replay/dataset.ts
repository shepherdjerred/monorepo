import { z } from "zod";
import { CapturedGuildConfigSchema } from "#src/explore/replay/profiles.ts";

/**
 * Pinning the pair of snapshots a replay run reads, and proving they belong
 * together.
 *
 * A replay dataset is two halves pulled separately: a Postgres snapshot and a
 * published report-lake build. They are not independent. `accounts.parquet`
 * inside a build is generated *from* Postgres during a rebuild, so a lake from
 * one stage beside a database from another — or from far enough apart in time
 * — does not error. It silently resolves one person into two identities, and
 * every answer computed on top reads as a model regression that never
 * happened.
 *
 * The compactor already refuses to fold across that boundary, comparing the
 * build manifest's PUUID-remap fingerprint against the database's. This module
 * reuses the same comparison as an entry condition for the eval, because an
 * eval that cannot trust its own dataset is worse than no eval.
 */

/**
 * The tables a replay can write into, and therefore the ones that prove a
 * snapshot is still the one that was pinned.
 *
 * Explore's dare, challenge and creation tools prepare rather than perform,
 * but preparing persists: a draft, and the single-use confirmation intent that
 * would enact it. Nothing rolls that back between cases.
 */
export const REPLAY_WRITABLE_TABLES = [
  "ConfirmationIntent",
  "BucksDareV2",
  // `draft_challenge_contract` writes a ChallengeDraft — a run is what a
  // confirmed contract produces, and a replay never confirms one.
  "ChallengeDraft",
] as const;

export const ReplayStageSchema = z.enum(["beta", "prod"]);
export type ReplayStage = z.infer<typeof ReplayStageSchema>;

export const StageDatasetPinSchema = z
  .object({
    schemaVersion: z.literal(1),
    stage: ReplayStageSchema,
    createdAt: z.iso.datetime(),
    lake: z
      .object({
        dir: z.string().min(1),
        buildId: z.string().min(1),
        /** Recorded at pull time; re-checked before every run. */
        puuidRemapFingerprint: z.string().min(1),
        pulledAt: z.iso.datetime(),
        sourcePod: z.string().min(1),
      })
      .strict(),
    database: z
      .object({
        name: z.string().min(1),
        url: z.string().min(1),
        pulledAt: z.iso.datetime(),
        /**
         * What the snapshot contains, not which instance holds it.
         *
         * `pulledAt` records when the pin was captured and the name is a slot
         * every pull restores in place, so neither can tell one snapshot from
         * another. The database's OID can, but it is the wrong identity here:
         * a sweep that drafts a dare writes to the snapshot, the coherence
         * check then demands a restore, and `dev:db-pull` drops and recreates
         * — so an OID would differ after restoring the very same data and the
         * baseline A/B this harness exists for could never run twice.
         *
         * Derived from content instead: restoring the same dump reproduces it,
         * and a different pull does not.
         */
        snapshotId: z.string().min(1),
        /**
         * A digest of each table a replay can write into.
         *
         * The agent's dare, challenge and creation tools persist: a draft and
         * the confirmation intent that would enact it. A replay runs them for
         * real against a snapshot with no rollback, so a sweep leaves the
         * snapshot slightly different from the one it started on, and the next
         * sweep would not be measuring the same world. Recorded here so a run
         * can refuse a snapshot that has moved since it was pinned.
         */
        writableRows: z.record(z.string().min(1), z.string().min(1)),
      })
      .strict(),
    accountRows: z
      .object({
        parquet: z.number().int().nonnegative(),
        database: z.number().int().nonnegative(),
      })
      .strict(),
    /**
     * Where the captured capabilities came from.
     *
     * `static` means the registry defaults plus static overrides, with no
     * provider consulted; `provider` means the stage's own Flipt decisions. A
     * static capture is a faithful record of static configuration and nothing
     * more — where provider targeting differs, the replay would reproduce and
     * assert a capability the guild does not actually have.
     */
    flagSource: z.enum(["static", "provider"]),
    verifiedAt: z.iso.datetime().nullable(),
    /**
     * What each target guild actually resolved when the dataset was pulled,
     * keyed by guild id. Local only, never committed: these are real guild and
     * account ids.
     */
    guilds: z
      .record(z.string().min(1), CapturedGuildConfigSchema)
      .refine(
        (guilds) => Object.keys(guilds).length > 0,
        "a dataset must target at least one guild",
      ),
  })
  .strict();

export type StageDatasetPin = z.infer<typeof StageDatasetPinSchema>;

/**
 * The lake was pulled before the database, so the database is the later of the
 * two and may legitimately know about accounts the lake has never seen. The
 * reverse cannot be legitimate: a lake referencing accounts the snapshot lacks
 * means the two came from different places.
 */
export type DatasetCoherenceFacts = {
  /** The live database's own identity, and the one the pin recorded. */
  readonly snapshotId: string;
  readonly pinnedSnapshotId: string;
  /** What the writable tables hold now, and held when the pin was captured. */
  readonly writableRows: Readonly<Record<string, string>>;
  readonly pinnedWritableRows: Readonly<Record<string, string>>;
  /** `undefined` when the build predates the fingerprint, or its manifest is unreadable. */
  readonly lakeFingerprint: string | undefined;
  readonly databaseFingerprint: string;
  readonly accountRows: {
    readonly parquet: number;
    readonly database: number;
  };
  readonly sampledPuuids: {
    readonly checked: number;
    readonly missingFromDatabase: number;
  };
};

/** The command that re-derives a coherent lake from the snapshot in hand. */
export function datasetRepairHint(pin: {
  readonly stage: ReplayStage;
  readonly database: { readonly url: string };
  readonly lake: { readonly dir: string };
}): string {
  return [
    "Rebuild the lake from the snapshot you already have, which is coherent by construction:",
    `  DATABASE_URL=${pin.database.url} \\`,
    `  REPORT_LAKE_DIR=${pin.lake.dir} \\`,
    `  S3_BUCKET_NAME=scout-${pin.stage} \\`,
    "  bun run --filter=@scout-for-lol/backend compact:report-lake",
  ].join("\n");
}

/**
 * Every reason this lake and this database do not describe the same world.
 *
 * Returns reasons rather than a boolean so a failure can say which check
 * failed; an empty array is the only thing that may start a run.
 */
export function datasetCoherenceIssues(
  facts: DatasetCoherenceFacts,
): readonly string[] {
  const issues: string[] = [];

  for (const [table, pinned] of Object.entries(facts.pinnedWritableRows)) {
    const now = facts.writableRows[table];
    if (now === undefined) {
      issues.push(`the snapshot no longer has a ${table} table to read`);
    } else if (now !== pinned) {
      issues.push(
        `${table} no longer matches the pin; a replay writes drafts and intents, so restore the snapshot before running again`,
      );
    }
  }

  if (facts.snapshotId !== facts.pinnedSnapshotId) {
    issues.push(
      `the database has been restored since this pin was captured (snapshot ${facts.snapshotId}, pin ${facts.pinnedSnapshotId}); re-capture the pin`,
    );
  }

  if (facts.lakeFingerprint === undefined) {
    // Not the same as a mismatch, and worth saying differently: the build is
    // older than the fingerprint or its manifest did not survive the copy.
    // Either way coherence cannot be proven, and an unprovable dataset is
    // treated exactly like a wrong one.
    issues.push(
      "the lake build records no PUUID remap fingerprint, so its identity domain cannot be proven",
    );
  } else if (facts.lakeFingerprint !== facts.databaseFingerprint) {
    issues.push(
      `PUUID remap fingerprint differs: lake ${facts.lakeFingerprint}, database ${facts.databaseFingerprint}`,
    );
  }

  if (facts.accountRows.parquet > facts.accountRows.database) {
    issues.push(
      `the lake holds more accounts than the database (${facts.accountRows.parquet.toString()} > ${facts.accountRows.database.toString()}), which a lake pulled first cannot legitimately do`,
    );
  }

  if (facts.sampledPuuids.missingFromDatabase > 0) {
    issues.push(
      `${facts.sampledPuuids.missingFromDatabase.toString()} of ${facts.sampledPuuids.checked.toString()} sampled lake PUUIDs are absent from the database snapshot`,
    );
  }

  return issues;
}

/**
 * Reasons this process is not pointed at the dataset it claims to be.
 *
 * The agent reads `DATABASE_URL` and `REPORT_LAKE_DIR` through module
 * singletons, so the only way to aim it is the environment. That makes a
 * stray value dangerous in both directions: the run would query a database
 * nobody pinned, and the lake-copy helpers delete their destination. So rather
 * than "never inherit these", the rule here is the inverse — refuse to start
 * unless they point exactly at the pin.
 */
function databaseUrlIssues(
  pin: StageDatasetPin,
  databaseUrl: string | undefined,
): readonly string[] {
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    return ["DATABASE_URL is unset"];
  }
  const parsed = safeParseUrl(databaseUrl);
  if (parsed === null) {
    return ["DATABASE_URL is not a parseable URL"];
  }
  const issues: string[] = [];
  const name = parsed.pathname.slice(1);
  if (name !== pin.database.name) {
    issues.push(
      `DATABASE_URL names database "${name}", but the dataset pins "${pin.database.name}"`,
    );
  }
  if (!isLoopback(parsed.hostname)) {
    // The snapshot is the point. A replay aimed at a hosted database would
    // read live rows and, worse, look like it worked.
    issues.push(
      `DATABASE_URL host "${parsed.hostname}" is not loopback; a replay must run against a local snapshot`,
    );
  }
  // Name and loopback are not enough: a second local Postgres on another port
  // can hold a database of the same name, and the coherence checks that run
  // later compare identity mappings and sampled accounts, not conversations or
  // runs. A stale copy would replay real-looking turns against the wrong rows.
  const pinned = safeParseUrl(pin.database.url);
  if (pinned !== null && parsed.port !== pinned.port) {
    issues.push(
      `DATABASE_URL points at port ${parsed.port === "" ? "the default" : parsed.port}, but the dataset pins ${pinned.port === "" ? "the default" : pinned.port}`,
    );
  }
  return issues;
}

export function replayEnvironmentIssues(input: {
  readonly pin: StageDatasetPin;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** `REPORT_LAKE_DIR` resolved the way the backend resolves it. */
  readonly resolvedLakeDir: string;
}): readonly string[] {
  const issues: string[] = [
    ...databaseUrlIssues(input.pin, input.environment["DATABASE_URL"]),
  ];

  if (input.resolvedLakeDir !== input.pin.lake.dir) {
    issues.push(
      `REPORT_LAKE_DIR resolves to "${input.resolvedLakeDir}", but the dataset pins "${input.pin.lake.dir}"`,
    );
  }

  // ENVIRONMENT changes flag resolution in exactly two ways, and both fire
  // only at prod: `isFeatureHardDisabled` short-circuits bucks and dares
  // (`flags.ts:219`), and `applicableOverrides` strips beta-only overrides
  // (`flags.ts:233-238`). A prod dataset must see both or it would grant
  // capabilities prod does not have.
  //
  // The caller does not supply that, though — the harness does, by flipping
  // ENVIRONMENT once `configuration` has memoized (see
  // `useStageFlagSemantics`). The same variable also makes `configuration`
  // demand a complete PostHog setup outside dev (`configuration.ts:151-159`),
  // config a replay never uses because nothing here builds an analytics
  // client. So the rule is the inverse of what it looks like it should be:
  // the caller must leave ENVIRONMENT at dev, and is refused if they pre-empt
  // the flip with a value that would strand the run on missing config.
  const environmentName = input.environment["ENVIRONMENT"];
  if (environmentName !== undefined && environmentName !== "dev") {
    issues.push(
      `ENVIRONMENT is "${environmentName}"; a replay must start as "dev" so configuration memoizes without stage config, and the harness applies the pinned stage's flag semantics itself`,
    );
  }

  const flagsMode = input.environment["FEATURE_FLAGS_MODE"];
  if (flagsMode !== "disabled" && flagsMode !== "static") {
    // With a live Flipt the profile's overrides are advisory and the run would
    // silently inherit whatever the stage has switched on today.
    issues.push(
      `FEATURE_FLAGS_MODE is "${flagsMode ?? "unset"}"; a replay needs "disabled" or "static" so the profile decides capabilities`,
    );
  }

  const temporal = input.environment["TEMPORAL_ADDRESS"];
  if (temporal !== undefined && temporal.trim() !== "") {
    // Nothing in a replay should start a workflow; an address is the only way
    // one could.
    issues.push(
      "TEMPORAL_ADDRESS is set; a replay must not be able to start workflows",
    );
  }

  return issues;
}

function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  );
}
