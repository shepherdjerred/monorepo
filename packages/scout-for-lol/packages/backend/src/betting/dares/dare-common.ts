import {
  BucksDareStateSchema,
  DareContractSchema,
  DARE_MAX_HORIZON_DAYS,
  DareDeadlineSpecSchema,
  DareTargetBindingSchema,
  type BucksDareState,
  type DareContract,
  type DareDeadlineSpec,
  type DareTargetBinding,
  type DiscordAccountId,
  type DiscordGuildId,
  type StorableDareChallengerStake,
} from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DareDependencies = {
  prismaClient: ExtendedPrismaClient;
  isPolicyEnabled: typeof isPolicyEnabled;
};

export const defaultDareDependencies: DareDependencies = {
  prismaClient: prisma,
  isPolicyEnabled,
};

export function dareDraftDeadlineIssues(
  spec: DareDeadlineSpec,
  now: Date,
): string[] {
  if (spec.kind === "relative") return [];
  const deadline = new Date(spec.deadlineAt);
  const issues: string[] = [];
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: spec.timezone }).format();
  } catch {
    issues.push(`${spec.timezone} is not an IANA timezone.`);
  }
  if (deadline.getTime() <= now.getTime()) {
    issues.push("An absolute dare deadline must be in the future.");
  }
  if (deadline.getTime() > now.getTime() + DARE_MAX_HORIZON_DAYS * DAY_MS) {
    issues.push(
      `A dare deadline may be at most ${DARE_MAX_HORIZON_DAYS.toString()} days away.`,
    );
  }
  return issues;
}

export async function claimDareDraftRevision(
  tx: Db,
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    challengerDiscordId: DiscordAccountId;
    expectedRevision: number;
    openingStake: StorableDareChallengerStake;
  },
): Promise<number | undefined> {
  const updated = await tx.bucksDare.updateManyAndReturn({
    where: {
      id: input.dareId,
      serverId: input.serverId,
      challengerDiscordId: input.challengerDiscordId,
      dareState: "draft",
      currentRevision: input.expectedRevision,
    },
    data: {
      currentRevision: { increment: 1 },
      openingStake: input.openingStake,
    },
    select: { currentRevision: true },
  });
  return updated.length === 1 ? updated[0]?.currentRevision : undefined;
}

/** Whether new Dares may be drafted in this guild. */
export async function dareSqlDraftsEnabled(
  serverId: DiscordGuildId,
  dependencies: DareDependencies,
): Promise<boolean> {
  return await dependencies.isPolicyEnabled("bucks_dares_enabled", {
    server: serverId,
  });
}

export async function dareSqlFundingEnabled(
  serverId: DiscordGuildId,
  dependencies: DareDependencies,
): Promise<boolean> {
  const [betting, authoring] = await Promise.all([
    dependencies.isPolicyEnabled("betting_enabled", { server: serverId }),
    dareSqlDraftsEnabled(serverId, dependencies),
  ]);
  return betting && authoring;
}

/**
 * Whether a funding action may run: the first funding needs the full rollout,
 * while every later action on an already-funded Dare needs only betting, so
 * revoking the Dare rollout never strands money already escrowed.
 */
export async function relationalDareActionEnabled(
  serverId: DiscordGuildId,
  initialFunding: boolean,
  dependencies: DareDependencies,
): Promise<boolean> {
  if (initialFunding) {
    return await dareSqlFundingEnabled(serverId, dependencies);
  }
  return await dependencies.isPolicyEnabled("betting_enabled", {
    server: serverId,
  });
}

export function parseDareTargets(raw: string): DareTargetBinding[] {
  return DareTargetBindingSchema.array().parse(JSON.parse(raw));
}

export function parseDareDeadline(raw: string): DareDeadlineSpec {
  return DareDeadlineSpecSchema.parse(JSON.parse(raw));
}

export function parseRelationalDareContract(raw: string): DareContract {
  return DareContractSchema.parse(JSON.parse(raw));
}

/**
 * The stored contract, or `null` when it does not parse. Settlement voids a
 * `null` with a full refund (`invalid_contract`) rather than guessing.
 */
export function readableRelationalDareContract(
  raw: string | null,
): DareContract | null {
  if (raw === null) return null;
  try {
    return DareContractSchema.safeParse(JSON.parse(raw)).data ?? null;
  } catch {
    return null;
  }
}

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
  const row = await reader.bucksDare.findUniqueOrThrow({
    where: { id: dareId },
    select: { dareState: true },
  });
  return BucksDareStateSchema.parse(row.dareState);
}

export function bindDareDeadline(
  spec: DareDeadlineSpec,
  activationAt: Date,
): Date {
  return spec.kind === "relative"
    ? new Date(activationAt.getTime() + spec.days * 24 * 60 * 60 * 1000)
    : new Date(spec.deadlineAt);
}
