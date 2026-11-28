import { initTRPC, TRPCError } from "@trpc/server";
import type { z } from "zod";
import {
  AddLinkInputSchema,
  ActorInputSchema,
  ChangeStatusInputSchema,
  CheckIncidentsInputSchema,
  CheckIncidentsResultSchema,
  ClaimDispatchInputSchema,
  DeclareIncidentInputSchema,
  EditIncidentInputSchema,
  HandoffInputSchema,
  IncidentDetailSchema,
  type IncidentErrorDataSchema,
  IncidentRefInputSchema,
  IncidentSummarySchema,
  JoinInputSchema,
  ListIncidentsInputSchema,
  PostUpdateInputSchema,
  ReleaseDispatchInputSchema,
  ReopenInputSchema,
  ResolveInputSchema,
  TakeCommandInputSchema,
  TakeCommandResultSchema,
  type ActorInput,
} from "#shared/contract.ts";
import { IncidentError } from "#domain/errors.ts";
import type { IncidentsService } from "#server/service.ts";
import { effectiveActor } from "#server/viewer.ts";

export type IncidentsContext = {
  readonly service: IncidentsService;
  /** The tailnet human behind a browser request, when Hub's ingress named one. */
  readonly viewer: ActorInput | null;
};

type ErrorData = z.output<typeof IncidentErrorDataSchema>["incident"];

/** Carries the wire conflict payload from the middleware to the error formatter. */
class IncidentConflictCause extends Error {
  override readonly name = "IncidentConflictCause";

  constructor(
    message: string,
    readonly payload: ErrorData,
  ) {
    super(message);
  }
}

const t = initTRPC.context<IncidentsContext>().create({
  errorFormatter: ({ shape, error }) =>
    error.cause instanceof IncidentConflictCause
      ? { ...shape, data: { ...shape.data, incident: error.cause.payload } }
      : shape,
});

/** Map domain refusals onto tRPC codes; CONFLICT carries `IncidentErrorData`. */
const procedure = t.procedure.use(async ({ ctx, next }) => {
  const result = await next();
  if (result.ok) return result;
  const cause = result.error.cause;
  if (!(cause instanceof IncidentError)) return result;
  const payload =
    cause.conflict === undefined
      ? undefined
      : await ctx.service.conflictPayload(cause.conflict);
  throw new TRPCError({
    code: cause.code,
    message: cause.message,
    cause:
      payload === undefined
        ? cause
        : new IncidentConflictCause(cause.message, payload),
  });
});

function asViewer<T extends { actor: ActorInput }>(
  input: T,
  viewer: ActorInput | null,
): T {
  return { ...input, actor: effectiveActor(input.actor, viewer) };
}

export const incidentsRouter = t.router({
  /** The human Hub's ingress identified, so the browser can show and send it. */
  viewer: procedure
    .output(ActorInputSchema.nullable())
    .query(({ ctx }) => ctx.viewer),
  list: procedure
    .input(ListIncidentsInputSchema.prefault({}))
    .output(IncidentSummarySchema.array())
    .query(({ ctx, input }) => ctx.service.list(input)),
  byRef: procedure
    .input(IncidentRefInputSchema)
    .output(IncidentDetailSchema)
    .query(({ ctx, input }) => ctx.service.byRef(input.ref)),
  check: procedure
    .input(CheckIncidentsInputSchema.prefault({}))
    .output(CheckIncidentsResultSchema)
    .query(({ ctx, input }) => ctx.service.check(input)),
  declare: procedure
    .input(DeclareIncidentInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.declare(asViewer(input, ctx.viewer)),
    ),
  postUpdate: procedure
    .input(PostUpdateInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.postUpdate(asViewer(input, ctx.viewer)),
    ),
  changeStatus: procedure
    .input(ChangeStatusInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.changeStatus(asViewer(input, ctx.viewer)),
    ),
  edit: procedure
    .input(EditIncidentInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.edit(asViewer(input, ctx.viewer)),
    ),
  addLink: procedure
    .input(AddLinkInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.addLink(asViewer(input, ctx.viewer)),
    ),
  join: procedure
    .input(JoinInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.join(asViewer(input, ctx.viewer)),
    ),
  leave: procedure
    .input(JoinInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.leave(asViewer(input, ctx.viewer)),
    ),
  take: procedure
    .input(TakeCommandInputSchema)
    .output(TakeCommandResultSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.take(asViewer(input, ctx.viewer)),
    ),
  claimDispatch: procedure
    .input(ClaimDispatchInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.claimDispatch(asViewer(input, ctx.viewer)),
    ),
  releaseDispatch: procedure
    .input(ReleaseDispatchInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.releaseDispatch(asViewer(input, ctx.viewer)),
    ),
  handoff: procedure
    .input(HandoffInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.handoff(asViewer(input, ctx.viewer)),
    ),
  resolve: procedure
    .input(ResolveInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.resolve(asViewer(input, ctx.viewer)),
    ),
  reopen: procedure
    .input(ReopenInputSchema)
    .output(IncidentDetailSchema)
    .mutation(({ ctx, input }) =>
      ctx.service.reopen(asViewer(input, ctx.viewer)),
    ),
});

export type IncidentsRouter = typeof incidentsRouter;
