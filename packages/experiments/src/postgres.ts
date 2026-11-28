import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "#generated/prisma/client.ts";
import {
  ExperimentEventSchema,
  ExperimentSchema,
  type Experiment,
} from "./contract.ts";
import {
  isDue,
  revisionConflict,
  summaryOf,
  type ExperimentState,
  type ExperimentWriteContext,
} from "./domain.ts";
import {
  checkFingerprint,
  fingerprintOf,
  nextMutation,
  requestIdOf,
  type ExperimentStore,
  type ExperimentWrite,
} from "./store.ts";

const ExperimentSnapshotSchema = ExperimentSchema.omit({ timeline: true });
const ExperimentStateSchema = ExperimentSnapshotSchema.omit({ isDue: true });
type Queries = Pick<
  Prisma.TransactionClient,
  "experimentRecord" | "experimentMutation"
>;

function asDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dueOn(today: string): Prisma.ExperimentRecordWhereInput {
  return { status: "running", reviewDate: { lte: asDate(today) } };
}

function projectedState(state: ExperimentState) {
  return {
    revision: state.revision,
    owner: state.owner,
    title: state.title,
    status: state.status,
    reviewDate: state.reviewDate === null ? null : asDate(state.reviewDate),
    updatedAt: new Date(state.updatedAt),
    state,
  };
}

async function timeline(queries: Queries, id: string, revision: number) {
  const rows = await queries.experimentMutation.findMany({
    where: { experimentId: id, revision: { lte: revision } },
    orderBy: { revision: "asc" },
    select: { event: true },
  });
  return rows.map(({ event }) => ExperimentEventSchema.parse(event));
}

async function replay(
  queries: Queries,
  requestId: string,
  fingerprint: string,
): Promise<Experiment | null> {
  const receipt = await queries.experimentMutation.findUnique({
    where: { requestId },
  });
  if (receipt === null) return null;
  checkFingerprint(receipt, fingerprint);
  const saved = ExperimentSnapshotSchema.parse(receipt.result);
  return {
    ...saved,
    timeline: await timeline(queries, saved.id, saved.revision),
  };
}

async function transact(
  db: PrismaClient,
  write: ExperimentWrite,
  context: ExperimentWriteContext,
): Promise<Experiment> {
  const requestId = requestIdOf(write);
  const fingerprint = fingerprintOf(write, context.actor);
  try {
    return await db.$transaction(async (tx) => {
      const receipt = await replay(tx, requestId, fingerprint);
      if (receipt !== null) return receipt;

      const row =
        "id" in write
          ? await tx.experimentRecord.findUnique({ where: { id: write.id } })
          : null;
      if (
        row !== null &&
        "id" in write &&
        row.revision !== write.command.input.expectedRevision
      ) {
        const settled = await replay(tx, requestId, fingerprint);
        if (settled !== null) return settled;
        throw revisionConflict();
      }
      const { state, event } = nextMutation(
        write,
        row === null ? undefined : ExperimentStateSchema.parse(row.state),
        context,
      );
      const projection = projectedState(state);
      if (row === null) {
        await tx.experimentRecord.create({
          data: { id: state.id, ...projection },
        });
      } else {
        const { count } = await tx.experimentRecord.updateMany({
          where: { id: row.id, revision: row.revision },
          data: projection,
        });
        if (count !== 1) {
          const settled = await replay(tx, requestId, fingerprint);
          if (settled !== null) return settled;
          throw revisionConflict();
        }
      }
      const result = { ...state, isDue: isDue(state, context.today) };
      await tx.experimentMutation.create({
        data: {
          requestId,
          fingerprint,
          experimentId: state.id,
          revision: state.revision,
          event,
          result,
        },
      });
      return {
        ...result,
        timeline: await timeline(tx, state.id, state.revision),
      };
    });
  } catch (error) {
    // Two concurrent creates can race on the receipt before sharing a record.
    // The losing transaction rolls back its draft before reading the winner.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const settled = await replay(db, requestId, fingerprint);
      if (settled !== null) return settled;
    }
    throw error;
  }
}

export function createPostgresExperimentStore(
  connectionString: string,
): ExperimentStore {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 4000 }),
  });
  return {
    async list(query, today) {
      const view = query.view ?? "all";
      const views = {
        drafts: "draft",
        running: "running",
        decided: "decided",
      } as const;
      const where: Prisma.ExperimentRecordWhereInput =
        view === "due"
          ? dueOn(today)
          : view === "all"
            ? {}
            : { status: views[view] };
      if (query.q !== undefined && query.q.length > 0) {
        const contains = query.q.replaceAll(/[\\%_]/gu, String.raw`\$&`);
        const text = { contains, mode: "insensitive" } as const;
        const id = query.q.toLowerCase();
        const exactId = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/u.test(id)
          ? [{ id }]
          : [];
        where.OR = [{ title: text }, { owner: text }, ...exactId];
      }
      const rows = await db.experimentRecord.findMany({
        where,
        orderBy: [
          view === "due" ? { reviewDate: "asc" } : { updatedAt: "desc" },
          { id: "asc" },
        ],
        select: { state: true },
      });
      return rows.map(({ state }) =>
        summaryOf(ExperimentStateSchema.parse(state), today),
      );
    },
    async find(id, today) {
      const row = await db.experimentRecord.findUnique({ where: { id } });
      if (row === null) return null;
      const state = ExperimentStateSchema.parse(row.state);
      return {
        ...state,
        isDue: isDue(state, today),
        timeline: await timeline(db, id, state.revision),
      };
    },
    countDue: (today) => db.experimentRecord.count({ where: dueOn(today) }),
    write: (write, context) => transact(db, write, context),
    async ping() {
      try {
        await db.experimentRecord.findFirst({ select: { id: true } });
        return true;
      } catch {
        return false;
      }
    },
    close: () => db.$disconnect(),
  };
}
