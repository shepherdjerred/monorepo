import type { ActorEnvelope } from "#shared/actor.ts";
import type { UnitOfWork } from "#application/unit-of-work.ts";
import type { StateType } from "#generated/prisma/client.ts";
import { TrackerError } from "#domain/error.ts";
import { audit } from "./issue-repository.ts";

function projectChanges(input: {
  name?: string | undefined;
  description?: string | undefined;
  color?: string | undefined;
  archived?: boolean | undefined;
}) {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.archived === undefined
      ? {}
      : { archivedAt: input.archived ? new Date() : null }),
  };
}
function labelChanges(input: {
  newName?: string | undefined;
  color?: string | undefined;
}) {
  return {
    ...(input.newName === undefined ? {} : { name: input.newName }),
    ...(input.color === undefined ? {} : { color: input.color }),
  };
}

export class Catalog {
  constructor(private readonly unit: UnitOfWork) {}

  project(
    input: {
      actor: ActorEnvelope;
      slug: string;
      name?: string | undefined;
      description?: string | undefined;
      color?: string | undefined;
      archived?: boolean | undefined;
    },
    create: boolean,
    requestId: string,
  ) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const before = await context.db.project.findUnique({
        where: { slug: input.slug },
      });
      if (create && before !== null)
        throw new TrackerError("CONFLICT", "Project already exists");
      if (!create && before === null)
        throw new TrackerError("NOT_FOUND", "Project not found");
      const after = create
        ? await context.db.project.create({
            data: {
              slug: input.slug,
              name: input.name ?? input.slug,
              description: input.description ?? "",
              color: input.color ?? "#8b5cf6",
            },
          })
        : await context.db.project.update({
            where: { slug: input.slug },
            data: projectChanges(input),
          });
      await audit(context, {
        entityType: "project",
        entityId: after.id,
        action: create ? "created" : "updated",
        ...(before === null ? {} : { before }),
        after,
      });
      return after;
    });
  }

  label(
    input: {
      actor: ActorEnvelope;
      teamKey: string;
      name: string;
      newName?: string | undefined;
      color?: string | undefined;
    },
    operation: "create" | "update" | "delete",
    requestId: string,
  ) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const team = await context.db.team.findUnique({
        where: { key: input.teamKey },
      });
      if (team === null) throw new TrackerError("BAD_REQUEST", "Unknown team");
      const where = { teamId_name: { teamId: team.id, name: input.name } };
      const before = await context.db.label.findUnique({ where });
      if (operation === "create" && before !== null)
        throw new TrackerError("CONFLICT", "Label already exists");
      if (operation !== "create" && before === null)
        throw new TrackerError("NOT_FOUND", "Label not found");
      const after =
        operation === "delete"
          ? await context.db.label.delete({ where })
          : operation === "create"
            ? await context.db.label.create({
                data: {
                  teamId: team.id,
                  name: input.name,
                  color: input.color ?? "#8b5cf6",
                },
              })
            : await context.db.label.update({
                where,
                data: labelChanges(input),
              });
      await audit(context, {
        entityType: "label",
        entityId: after.id,
        action: operation,
        ...(before === null ? {} : { before }),
        ...(operation === "delete" ? {} : { after }),
      });
      return after;
    });
  }

  state(
    input: {
      actor: ActorEnvelope;
      teamKey: string;
      id?: string | undefined;
      name: string;
      type: StateType;
      color: string;
      position: number;
    },
    requestId: string,
  ) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const team = await context.db.team.findUnique({
        where: { key: input.teamKey },
      });
      if (team === null) throw new TrackerError("BAD_REQUEST", "Unknown team");
      const before =
        input.id === undefined
          ? null
          : await context.db.workflowState.findFirst({
              where: { id: input.id, teamId: team.id },
            });
      if (before === null && input.id !== undefined)
        throw new TrackerError("NOT_FOUND", "State not found");
      if (before !== null && before.type !== input.type)
        throw new TrackerError(
          "BAD_REQUEST",
          "State type is immutable; create a new state and move its issues",
        );
      const data = {
        name: input.name,
        type: input.type,
        color: input.color,
        position: input.position,
      };
      const after =
        before === null
          ? await context.db.workflowState.create({
              data: { ...data, teamId: team.id },
            })
          : await context.db.workflowState.update({
              where: { id: before.id },
              data,
            });
      await audit(context, {
        entityType: "state",
        entityId: after.id,
        action: before === null ? "created" : "updated",
        ...(before === null ? {} : { before }),
        after,
      });
      return after;
    });
  }

  reorder(
    input: { actor: ActorEnvelope; teamKey: string; ids: string[] },
    requestId: string,
  ) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const states = await context.db.workflowState.findMany({
        where: { team: { key: input.teamKey } },
        orderBy: { id: "asc" },
      });
      if (
        new Set(input.ids).size !== states.length ||
        states.some(({ id }) => !input.ids.includes(id))
      )
        throw new TrackerError(
          "BAD_REQUEST",
          "Include each state exactly once",
        );
      for (const state of states)
        await context.db
          .$queryRaw`SELECT "id" FROM "WorkflowState" WHERE "id" = ${state.id} FOR UPDATE`;
      for (const [position, id] of input.ids.entries())
        await context.db.workflowState.update({
          where: { id },
          data: { position },
        });
      await audit(context, {
        entityType: "team",
        entityId: input.teamKey,
        action: "states-reordered",
        before: {
          ids: states
            .toSorted(
              (a, b) => a.position - b.position || a.id.localeCompare(b.id),
            )
            .map(({ id }) => id),
        },
        after: { ids: input.ids },
      });
      return { reordered: true };
    });
  }
}
