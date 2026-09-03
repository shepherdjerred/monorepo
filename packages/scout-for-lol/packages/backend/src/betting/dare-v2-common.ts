import {
  BucksDareV2StateSchema,
  DareContractV2Schema,
  DareContractV3Schema,
  DareDeadlineSpecV2Schema,
  DareTargetBindingV2Schema,
  type BucksDareV2State,
  type DareContractV2,
  type DareContractV3,
  type DareDeadlineSpecV2,
  type DareTargetBindingV2,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

export type DareV2Dependencies = {
  prismaClient: ExtendedPrismaClient;
  isPolicyEnabled: typeof isPolicyEnabled;
};

export const defaultDareV2Dependencies: DareV2Dependencies = {
  prismaClient: prisma,
  isPolicyEnabled,
};

export async function dareV2DraftsEnabled(
  serverId: DiscordGuildId,
  dependencies: DareV2Dependencies,
): Promise<boolean> {
  return await dependencies.isPolicyEnabled("dare_v2", {
    server: serverId,
  });
}

export async function dareSqlV3DraftsEnabled(
  serverId: DiscordGuildId,
  dependencies: DareV2Dependencies,
): Promise<boolean> {
  const [sqlV3, relational] = await Promise.all([
    dependencies.isPolicyEnabled("dare_extended_contracts_enabled", {
      server: serverId,
    }),
    dependencies.isPolicyEnabled("scoutql_relational_enabled", {
      server: serverId,
    }),
  ]);
  return sqlV3 && relational;
}

export async function dareSqlV3FundingEnabled(
  serverId: DiscordGuildId,
  dependencies: DareV2Dependencies,
): Promise<boolean> {
  const [betting, authoring] = await Promise.all([
    dependencies.isPolicyEnabled("betting_enabled", { server: serverId }),
    dareSqlV3DraftsEnabled(serverId, dependencies),
  ]);
  return betting && authoring;
}

export async function relationalDareActionEnabled(
  serverId: DiscordGuildId,
  compilerVersion: string,
  initialFunding: boolean,
  dependencies: DareV2Dependencies,
): Promise<boolean> {
  if (compilerVersion !== "dare-sql-3") {
    return await dareV2FundingEnabled(serverId, dependencies);
  }
  if (initialFunding) {
    return await dareSqlV3FundingEnabled(serverId, dependencies);
  }
  return await dependencies.isPolicyEnabled("betting_enabled", {
    server: serverId,
  });
}

export async function dareV2FundingEnabled(
  serverId: DiscordGuildId,
  dependencies: DareV2Dependencies,
): Promise<boolean> {
  const [betting, v2, relational] = await Promise.all([
    dependencies.isPolicyEnabled("betting_enabled", { server: serverId }),
    dependencies.isPolicyEnabled("dare_v2", {
      server: serverId,
    }),
    dependencies.isPolicyEnabled("scoutql_relational_enabled", {
      server: serverId,
    }),
  ]);
  return betting && v2 && relational;
}

export function parseDareV2Targets(raw: string): DareTargetBindingV2[] {
  return DareTargetBindingV2Schema.array().parse(JSON.parse(raw));
}

export function parseDareV2Deadline(raw: string): DareDeadlineSpecV2 {
  return DareDeadlineSpecV2Schema.parse(JSON.parse(raw));
}

export function parseDareV2Contract(raw: string): DareContractV2 {
  return DareContractV2Schema.parse(JSON.parse(raw));
}

export function readableDareV2Contract(
  raw: string | null,
): DareContractV2 | null {
  if (raw === null) return null;
  try {
    return DareContractV2Schema.safeParse(JSON.parse(raw)).data ?? null;
  } catch {
    return null;
  }
}

export type RelationalDareContract = DareContractV2 | DareContractV3;

export function parseRelationalDareContract(
  raw: string,
): RelationalDareContract {
  const value: unknown = JSON.parse(raw);
  const v3 = DareContractV3Schema.safeParse(value);
  return v3.success ? v3.data : DareContractV2Schema.parse(value);
}

export function readableRelationalDareContract(
  raw: string | null,
): RelationalDareContract | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return (
      DareContractV3Schema.safeParse(value).data ??
      DareContractV2Schema.safeParse(value).data ??
      null
    );
  } catch {
    return null;
  }
}

export function dareV2ScoutQlPlanHash(contract: DareContractV2): string | null {
  return "scoutQlPlanHash" in contract ? contract.scoutQlPlanHash : null;
}

export async function currentDareV2State(
  reader: {
    bucksDareV2: {
      findUniqueOrThrow: (args: {
        where: { id: number };
        select: { dareState: true };
      }) => Promise<{ dareState: string }>;
    };
  },
  dareId: number,
): Promise<BucksDareV2State> {
  const row = await reader.bucksDareV2.findUniqueOrThrow({
    where: { id: dareId },
    select: { dareState: true },
  });
  return BucksDareV2StateSchema.parse(row.dareState);
}

export function bindDareV2Deadline(
  spec: DareDeadlineSpecV2,
  activationAt: Date,
): Date {
  if (spec.kind === "relative") {
    return new Date(activationAt.getTime() + spec.days * 24 * 60 * 60 * 1000);
  }
  return new Date(spec.deadlineAt);
}
