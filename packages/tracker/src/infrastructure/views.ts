import type { Prisma } from "#generated/prisma/client.ts";
import type { UnitOfWork } from "#application/unit-of-work.ts";
import { TrackerError } from "#domain/error.ts";
import {
  ViewParamsSchema,
  type CreateViewInput,
  type ReorderViewsInput,
  type UpdateViewInput,
  type ViewReferenceInput,
} from "#shared/schema.ts";
import { audit, json, presentActor } from "./issue-repository.ts";

const viewInclude = {
  team: true,
  createdBy: true,
} satisfies Prisma.ViewInclude;
type ViewRecord = Prisma.ViewGetPayload<{ include: typeof viewInclude }>;

const presentView = (view: ViewRecord) => ({
  id: view.id,
  name: view.name,
  icon: view.icon,
  params: ViewParamsSchema.parse(view.params),
  teamKey: view.team?.key ?? null,
  position: view.position,
  createdBy: presentActor(view.createdBy),
  createdAt: view.createdAt,
  updatedAt: view.updatedAt,
});

async function resolveTeamId(
  db: Prisma.TransactionClient,
  key: string | null | undefined,
) {
  if (key === undefined) return;
  if (key === null) return null;
  const team = await db.team.findUnique({ where: { key } });
  if (team === null)
    throw new TrackerError("BAD_REQUEST", `Unknown team ${key}`);
  return team.id;
}

/** Locks every view, in ID order, and returns them in display order. */
async function lockViews(db: Prisma.TransactionClient) {
  await db.$queryRaw`SELECT "id" FROM "View" ORDER BY "id" FOR UPDATE`;
  return db.view.findMany({
    include: viewInclude,
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
}

/** Saved issue-list views: global when they have no team. */
export class Views {
  constructor(private readonly unit: UnitOfWork) {}

  /** A team's list includes the global views. */
  async list(db: Prisma.TransactionClient, teamKey?: string) {
    const views = await db.view.findMany({
      where:
        teamKey === undefined
          ? {}
          : { OR: [{ teamId: null }, { team: { key: teamKey } }] },
      include: viewInclude,
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    return views.map((view) => presentView(view));
  }

  create(input: CreateViewInput, requestId: string) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const { db } = context;
      const existing = await lockViews(db);
      const view = await db.view.create({
        data: {
          name: input.name,
          icon: input.icon,
          params: json(input.params),
          teamId: (await resolveTeamId(db, input.teamKey)) ?? null,
          position: (existing.at(-1)?.position ?? -1) + 1,
          createdById: context.actor.id,
        },
        include: viewInclude,
      });
      const after = presentView(view);
      await audit(context, {
        entityType: "view",
        entityId: view.id,
        action: "created",
        after,
      });
      return after;
    });
  }

  update(input: UpdateViewInput, requestId: string) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const { db } = context;
      const views = await lockViews(db);
      const before = views.find(({ id }) => id === input.id);
      if (before === undefined)
        throw new TrackerError("NOT_FOUND", "View not found");
      const teamId = await resolveTeamId(db, input.teamKey);
      const after = presentView(
        await db.view.update({
          where: { id: input.id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.icon === undefined ? {} : { icon: input.icon }),
            ...(input.params === undefined
              ? {}
              : { params: json(input.params) }),
            ...(teamId === undefined ? {} : { teamId }),
          },
          include: viewInclude,
        }),
      );
      await audit(context, {
        entityType: "view",
        entityId: input.id,
        action: "updated",
        before: presentView(before),
        after,
      });
      return after;
    });
  }

  delete(input: ViewReferenceInput, requestId: string) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const views = await lockViews(context.db);
      const before = views.find(({ id }) => id === input.id);
      if (before === undefined)
        throw new TrackerError("NOT_FOUND", "View not found");
      await context.db.view.delete({ where: { id: input.id } });
      await audit(context, {
        entityType: "view",
        entityId: input.id,
        action: "deleted",
        before: presentView(before),
      });
      return { deleted: true };
    });
  }

  reorder(input: ReorderViewsInput, requestId: string) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const views = await lockViews(context.db);
      if (
        new Set(input.ids).size !== views.length ||
        views.some(({ id }) => !input.ids.includes(id))
      )
        throw new TrackerError("BAD_REQUEST", "Include each view exactly once");
      for (const [position, id] of input.ids.entries())
        await context.db.view.update({ where: { id }, data: { position } });
      await audit(context, {
        entityType: "view",
        entityId: "order",
        action: "reordered",
        before: { ids: views.map(({ id }) => id) },
        after: { ids: input.ids },
      });
      return { reordered: true };
    });
  }
}
