import {
  BucksDareStateSchema,
  type BucksDareState,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  DareConditionsSchema,
  renderDareConditions,
} from "#src/betting/dare-criteria.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-dare-common");

/**
 * Plumbing shared by the dare command-surface domain modules (create,
 * accept, contribute). Deliberately free of money movement — that lives in
 * `dare-ledger.ts`.
 */

export type DareDomainDependencies = {
  prismaClient: ExtendedPrismaClient;
  isPolicyEnabled: typeof isPolicyEnabled;
};

export const defaultDareDependencies: DareDomainDependencies = {
  prismaClient: prisma,
  isPolicyEnabled,
};

/**
 * Both flags gate taking money for a dare: the betting economy itself plus
 * the narrower dares rollout. Refund and settlement paths never call this —
 * flags gate taking Bucks, never returning them.
 */
export async function daresFeatureEnabled(
  serverId: DiscordGuildId,
  dependencies: DareDomainDependencies,
): Promise<boolean> {
  const [bettingEnabled, daresEnabled] = await Promise.all([
    dependencies.isPolicyEnabled("betting_enabled", { server: serverId }),
    dependencies.isPolicyEnabled("bucks_dares_enabled", { server: serverId }),
  ]);
  return bettingEnabled && daresEnabled;
}

export type LoadedDare = NonNullable<
  Awaited<ReturnType<typeof loadDareWithTargets>>
>;

/** One dare plus its frozen target rows, scoped to the guild. */
export async function loadDareWithTargets(
  prismaClient: ExtendedPrismaClient,
  dareId: number,
  serverId: DiscordGuildId,
) {
  const dare = await prismaClient.bucksDare.findUnique({
    where: { id: dareId },
    include: { targets: { orderBy: { id: "asc" } } },
  });
  if (dare?.serverId !== serverId) {
    return;
  }
  return dare;
}

/**
 * The challenger-only entry points (confirm, abandon) share one lookup: the
 * dare must exist in this guild and belong to this challenger.
 */
export async function loadChallengerDare(
  prismaClient: ExtendedPrismaClient,
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    challengerDiscordId: string;
  },
): Promise<
  | { kind: "ok"; dare: LoadedDare }
  | { kind: "not_found" }
  | { kind: "not_challenger" }
> {
  const dare = await loadDareWithTargets(
    prismaClient,
    input.dareId,
    input.serverId,
  );
  if (dare === undefined) {
    return { kind: "not_found" };
  }
  if (dare.challengerDiscordId !== input.challengerDiscordId) {
    return { kind: "not_challenger" };
  }
  return { kind: "ok", dare };
}

/**
 * The target-only entry points (accept, chicken) share one lookup: the dare
 * must exist in this guild, list this target, and that target must not have
 * accepted already — consent is irrevocable.
 */
export async function loadTargetDare(
  prismaClient: ExtendedPrismaClient,
  input: { dareId: number; serverId: DiscordGuildId; targetDiscordId: string },
): Promise<
  | { kind: "ok"; dare: LoadedDare; target: LoadedDare["targets"][number] }
  | { kind: "not_found" }
  | { kind: "not_a_target" }
  | { kind: "already_accepted" }
> {
  const dare = await loadDareWithTargets(
    prismaClient,
    input.dareId,
    input.serverId,
  );
  if (dare === undefined) {
    return { kind: "not_found" };
  }
  const target = dare.targets.find(
    (row) => row.discordId === input.targetDiscordId,
  );
  if (target === undefined) {
    return { kind: "not_a_target" };
  }
  if (target.acceptedAt !== null) {
    return { kind: "already_accepted" };
  }
  return { kind: "ok", dare, target };
}

/** The code-rendered condition summary for a stored dare row — the one
 * human description, frozen into every ledger context. */
export function summarizeDare(dare: {
  conditions: string;
  targets: readonly { alias: string }[];
}): string {
  return renderDareConditions(
    DareConditionsSchema.parse(JSON.parse(dare.conditions)),
    dare.targets.map((target) => target.alias),
  );
}

/** Display placeholder when a stored conditions blob cannot be parsed on a
 * refund path. See `summarizeDareBestEffort`. */
export const DARE_CONDITIONS_UNREADABLE = "(dare conditions unreadable)";

/**
 * Best-effort condition summary for refund, void, abandon, and expire paths.
 *
 * Those paths run REGARDLESS of whether the stored conditions blob still
 * parses — that is the documented refunds-are-never-blocked invariant: money
 * movement must not depend on a display string, so a blob the current schema
 * cannot read gets a fixed placeholder instead of an exception. This is
 * display-only, NOT a data-quality fallback — the achieved/settlement path
 * still parses strictly through `parseDare` and fails loudly.
 */
export function summarizeDareBestEffort(dare: {
  conditions: string;
  targets: readonly { alias: string }[];
}): string {
  try {
    return summarizeDare(dare);
  } catch (error) {
    logger.warn(
      "⚠️ Dare conditions could not be rendered for a refund-path summary:",
      error,
    );
    return DARE_CONDITIONS_UNREADABLE;
  }
}

/** Fresh state read for a miss-path answer — the pre-transaction row is
 * stale by definition once a guarded claim has missed. */
export async function currentDareState(
  reader: {
    bucksDare: {
      findUniqueOrThrow: (args: {
        where: { id: number };
        select: { dareState: true };
      }) => Promise<{ dareState: string }>;
    };
  },
  dareId: number,
): Promise<BucksDareState> {
  const current = await reader.bucksDare.findUniqueOrThrow({
    where: { id: dareId },
    select: { dareState: true },
  });
  return BucksDareStateSchema.parse(current.dareState);
}

/** The precise-copy re-read after an `InsufficientBucksError` rollback. */
export async function insufficientDareFunds(
  prismaClient: ExtendedPrismaClient,
  bucksAccountId: number,
  needed: number,
): Promise<{ kind: "insufficient"; balance: number; needed: number }> {
  const current = await prismaClient.bucksAccount.findUniqueOrThrow({
    where: { id: bucksAccountId },
    select: { balance: true },
  });
  return { kind: "insufficient", balance: current.balance, needed };
}
