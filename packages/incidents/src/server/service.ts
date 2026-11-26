/**
 * The incidents application service: every query and command the tRPC router
 * exposes, plus signal ingestion. Inputs arrive already parsed by the
 * contract's schemas.
 */
import type { z } from "zod";
import {
  isOpenStatus,
  type AddLinkInputSchema,
  type ChangeStatusInputSchema,
  type CheckIncidentsInputSchema,
  type CheckIncidentsResult,
  type ClaimDispatchInputSchema,
  type DeclareIncidentInputSchema,
  type EditIncidentInputSchema,
  type HandoffInputSchema,
  type IncidentDetail,
  type IncidentSummary,
  type JoinInputSchema,
  type ListIncidentsInputSchema,
  type PostUpdateInputSchema,
  type ReleaseDispatchInputSchema,
  type ReopenInputSchema,
  type ResolveInputSchema,
  type TakeCommandInputSchema,
  type TakeCommandResult,
} from "#shared/contract.ts";
import {
  claimDispatch,
  handoff,
  isCommander,
  isSuspect,
  mayTakeNow,
  releaseDispatch,
  take,
} from "#domain/command.ts";
import { IncidentError } from "#domain/errors.ts";
import {
  addLink,
  changeStatus,
  declare,
  edit,
  join,
  leave,
  postUpdate,
  reopen,
  resolve,
} from "#domain/incident.ts";
import {
  compareOpenPriority,
  type IncidentRecord,
  type Transition,
} from "#domain/model.ts";
import { SystemsTakenError } from "#infrastructure/repository.ts";
import {
  actorRef,
  createServiceCore,
  type Decide,
  type ServiceOptions,
} from "#server/service-core.ts";
import { createSignalIngest } from "#server/service-signals.ts";
import { presentAt } from "#server/read-model.ts";

type Out<S extends z.ZodType> = z.output<S>;

function unchanged<T>(transition: Transition, result: T) {
  return { transition, result };
}

/** Decide a plain Transition-returning command. */
function plain(
  run: (...args: Parameters<Decide<null>>) => Transition,
): Decide<null> {
  return (...args) => unchanged(run(...args), null);
}

export function createIncidentsService(options: ServiceOptions) {
  const core = createServiceCore(options);
  const { repository } = core;
  const signals = createSignalIngest(core);

  const detailOf = async (record: IncidentRecord): Promise<IncidentDetail> =>
    core.detail(record);

  const list = async (
    input: Out<typeof ListIncidentsInputSchema>,
  ): Promise<IncidentSummary[]> => {
    // The repository orders open listings by priority before the limit.
    const records = await repository.listIncidents(input);
    return core.summaries(records);
  };

  const check = async (
    input: Out<typeof CheckIncidentsInputSchema>,
  ): Promise<CheckIncidentsResult> => {
    const now = options.clock();
    const openRecords = await repository.openIncidents();
    const open = openRecords
      .filter(
        (record) =>
          input.system === undefined || record.systems.includes(input.system),
      )
      .map((record) => presentAt(record, now))
      .sort(compareOpenPriority);
    const known =
      input.actor === undefined
        ? null
        : await repository.findActorByKey(input.actor.key);
    const ref =
      input.actor === undefined
        ? null
        : {
            id: known?.id ?? "",
            key: input.actor.key,
            kind: input.actor.kind,
            metadata: input.actor.metadata ?? known?.metadata ?? null,
          };
    const summaries = await core.summaries(open);
    const incidents = open.map((record, index) => {
      const incident = summaries[index];
      if (incident === undefined) throw new Error("summary missing");
      return {
        incident,
        relation: {
          commander: ref !== null && isCommander(record, ref),
          creator: ref !== null && record.creatorId === ref.id,
          suspect: ref !== null && isSuspect(record.suspect, ref.metadata),
          affected:
            ref !== null &&
            record.affected.some((entry) => entry.actorId === ref.id),
          canTake:
            ref !== null &&
            record.commandState === "none" &&
            isOpenStatus(record.status) &&
            mayTakeNow(record, ref, now),
        },
      };
    });
    return { checkedAt: now.toISOString(), incidents };
  };

  const declareIncident = async (
    input: Out<typeof DeclareIncidentInputSchema>,
  ): Promise<IncidentDetail> => {
    const settings = await core.requireEnabled();
    const actor = await repository.upsertActor(input.actor, options.clock());
    const { actor: _actor, ...fields } = input;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const open = await repository.openIncidents();
      const transition = declare(fields, core.domainContext(actorRef(actor)), {
        open,
        takeoverGraceSeconds: settings.takeoverGraceSeconds,
      });
      try {
        return await detailOf(await core.commitOrCreate(null, transition));
      } catch (error: unknown) {
        if (!(error instanceof SystemsTakenError)) throw error;
        const duplicate = await core.duplicateFrom(error, transition.next);
        if (duplicate !== null) throw duplicate;
      }
    }
    throw new IncidentError(
      "CONFLICT",
      "Systems are changing too fast to declare; retry",
    );
  };

  const simple = async (
    input: {
      ref: string;
      actor: Out<typeof PostUpdateInputSchema>["actor"];
      expectedRevision?: number;
    },
    decide: Decide<null>,
    needsOpen = false,
  ): Promise<IncidentDetail> => {
    const { record } = await core.mutate({
      ref: input.ref,
      actor: input.actor,
      ...(input.expectedRevision === undefined
        ? {}
        : { expectedRevision: input.expectedRevision }),
      needsOpen,
      decide,
    });
    return detailOf(record);
  };

  const takeCommand = async (
    input: Out<typeof TakeCommandInputSchema>,
  ): Promise<TakeCommandResult> => {
    const token = options.newToken();
    const { record, result } = await core.mutate({
      ref: input.ref,
      actor: input.actor,
      decide: (current, context, _open, settings) => {
        const decision = take(
          current,
          context,
          {
            dispatch: input.dispatch,
            force: input.force,
            note: input.note ?? null,
            dispatchToken: token,
          },
          settings,
        );
        return { transition: decision.transition, result: decision };
      },
    });
    const [incident] = await core.summaries([record]);
    if (incident === undefined) throw new Error("summary missing");
    if (result.outcome === "taken")
      return { outcome: "taken", incident, reason: result.reason };
    if (result.outcome === "owned") return { outcome: "owned", incident };
    return {
      outcome: "dispatching",
      incident,
      dispatchToken: result.dispatchToken,
      leaseExpiresAt: result.leaseExpiresAt.toISOString(),
      provider: result.provider,
    };
  };

  const handoffCommand = async (
    input: Out<typeof HandoffInputSchema>,
  ): Promise<IncidentDetail> => {
    const target =
      input.to === null ? null : await repository.findActorByKey(input.to);
    if (target === null && input.to !== null)
      throw new IncidentError(
        "NOT_FOUND",
        `No actor ${input.to}; the new commander must have used incidents before`,
      );
    return simple(
      input,
      plain((record, context) =>
        handoff(
          record,
          context,
          target === null ? null : actorRef(target),
          input.note ?? null,
        ),
      ),
    );
  };

  return {
    settings: core.settings,
    conflictPayload: core.conflictPayload,
    ready: () => repository.ping(),
    close: () => repository.close(),
    list,
    check,
    byRef: async (ref: string) => detailOf(await core.load(ref)),
    declare: declareIncident,
    postUpdate: async (input: Out<typeof PostUpdateInputSchema>) =>
      simple(
        input,
        plain((record, context) => postUpdate(record, context, input.body)),
      ),
    changeStatus: async (input: Out<typeof ChangeStatusInputSchema>) =>
      simple(
        input,
        plain((record, context) =>
          changeStatus(record, context, input.status, input.note ?? null),
        ),
      ),
    edit: async (input: Out<typeof EditIncidentInputSchema>) => {
      const { actor: _a, ref: _r, expectedRevision: _e, ...fields } = input;
      return simple(
        input,
        plain((record, context, open) => edit(record, context, fields, open)),
        true,
      );
    },
    addLink: async (input: Out<typeof AddLinkInputSchema>) =>
      simple(
        input,
        plain((record, context) => addLink(record, context, input.link)),
      ),
    join: async (input: Out<typeof JoinInputSchema>) =>
      simple(
        input,
        plain((record, context) => join(record, context, input.note ?? null)),
      ),
    leave: async (input: Out<typeof JoinInputSchema>) =>
      simple(
        input,
        plain((record, context) => leave(record, context, input.note ?? null)),
      ),
    take: takeCommand,
    claimDispatch: async (input: Out<typeof ClaimDispatchInputSchema>) =>
      simple(
        input,
        plain((record, context) =>
          claimDispatch(record, context, input.dispatchToken),
        ),
      ),
    releaseDispatch: async (input: Out<typeof ReleaseDispatchInputSchema>) =>
      simple(
        input,
        plain((record, context) =>
          releaseDispatch(record, context, input.dispatchToken, input.reason),
        ),
      ),
    handoff: handoffCommand,
    resolve: async (input: Out<typeof ResolveInputSchema>) =>
      simple(
        input,
        plain((record, context) =>
          resolve(record, context, { note: input.note, force: input.force }),
        ),
      ),
    reopen: async (input: Out<typeof ReopenInputSchema>) =>
      simple(
        input,
        plain((record, context, open) =>
          reopen(record, context, input.note, open),
        ),
        true,
      ),
    applySignals: signals.applySignals,
    alertmanager: signals.alertmanager,
  };
}

export type IncidentsService = ReturnType<typeof createIncidentsService>;
