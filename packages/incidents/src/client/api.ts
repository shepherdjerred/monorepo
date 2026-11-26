/**
 * The browser's incidents client: tRPC's HTTP wire format (no transformer,
 * no batching) spoken with `fetch`, every input and output parsed with the
 * shared contract. The pages never import the router type, so the client
 * layer depends on `shared` alone.
 */
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import {
  ActorInputSchema,
  AddLinkInputSchema,
  ChangeStatusInputSchema,
  DeclareIncidentInputSchema,
  HandoffInputSchema,
  IncidentDetailSchema,
  IncidentErrorDataSchema,
  IncidentRefInputSchema,
  IncidentSummarySchema,
  INCIDENTS_API_PREFIX,
  JoinInputSchema,
  ListIncidentsInputSchema,
  PostUpdateInputSchema,
  ReopenInputSchema,
  ResolveInputSchema,
  TakeCommandInputSchema,
  TakeCommandResultSchema,
  type ActorInput,
  type ListIncidentsInput,
} from "#shared/contract.ts";

const TRPC_PATH = `${INCIDENTS_API_PREFIX}/trpc`;

const TrpcResultSchema = z.object({ result: z.object({ data: z.unknown() }) });
const TrpcErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    data: z.looseObject({ code: z.string(), incident: z.unknown().optional() }),
  }),
});

export type IncidentConflict = z.output<
  typeof IncidentErrorDataSchema
>["incident"];

/** A refused query or command, with the tRPC code and any conflict payload. */
export class IncidentsApiError extends Error {
  override readonly name = "IncidentsApiError";

  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly conflict: IncidentConflict | null,
  ) {
    super(message);
  }
}

async function settle<S extends z.ZodType>(
  response: Response,
  output: S,
): Promise<z.output<S>> {
  const body: unknown = await response.json();
  if (response.ok)
    return output.parse(TrpcResultSchema.parse(body).result.data);
  const { error } = TrpcErrorSchema.parse(body);
  // A CONFLICT that carries a payload must match the contract; a mismatch is
  // a broken producer, so it throws instead of degrading to a plain message.
  const conflict =
    error.data.incident === undefined
      ? null
      : IncidentErrorDataSchema.parse(error.data).incident;
  throw new IncidentsApiError(
    error.message,
    error.data.code,
    response.status,
    conflict,
  );
}

async function query<S extends z.ZodType>(
  path: string,
  input: unknown,
  output: S,
  signal?: AbortSignal,
): Promise<z.output<S>> {
  const search =
    input === undefined
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await fetch(`${TRPC_PATH}/${path}${search}`, {
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  return settle(response, output);
}

const MUTATIONS = {
  declare: { input: DeclareIncidentInputSchema, output: IncidentDetailSchema },
  postUpdate: { input: PostUpdateInputSchema, output: IncidentDetailSchema },
  changeStatus: {
    input: ChangeStatusInputSchema,
    output: IncidentDetailSchema,
  },
  addLink: { input: AddLinkInputSchema, output: IncidentDetailSchema },
  join: { input: JoinInputSchema, output: IncidentDetailSchema },
  take: { input: TakeCommandInputSchema, output: TakeCommandResultSchema },
  handoff: { input: HandoffInputSchema, output: IncidentDetailSchema },
  resolve: { input: ResolveInputSchema, output: IncidentDetailSchema },
  reopen: { input: ReopenInputSchema, output: IncidentDetailSchema },
} as const;

type Mutations = typeof MUTATIONS;
export type IncidentMutation = keyof Mutations;
export type MutationInput<K extends IncidentMutation> = z.input<
  Mutations[K]["input"]
>;
export type MutationOutput<K extends IncidentMutation> = z.output<
  Mutations[K]["output"]
>;

function post<I extends z.ZodType, O extends z.ZodType>(
  name: IncidentMutation,
  spec: { readonly input: I; readonly output: O },
): (input: z.input<I>) => Promise<z.output<O>> {
  return async (input) => {
    // Validated here first, so a bad form never reaches the wire.
    const response = await fetch(`${TRPC_PATH}/${name}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(spec.input.parse(input)),
    });
    return settle(response, spec.output);
  };
}

const COMMANDS: {
  readonly [K in IncidentMutation]: (
    input: MutationInput<K>,
  ) => Promise<MutationOutput<K>>;
} = {
  declare: post("declare", MUTATIONS.declare),
  postUpdate: post("postUpdate", MUTATIONS.postUpdate),
  changeStatus: post("changeStatus", MUTATIONS.changeStatus),
  addLink: post("addLink", MUTATIONS.addLink),
  join: post("join", MUTATIONS.join),
  take: post("take", MUTATIONS.take),
  handoff: post("handoff", MUTATIONS.handoff),
  resolve: post("resolve", MUTATIONS.resolve),
  reopen: post("reopen", MUTATIONS.reopen),
};

/** Run one command against `/api/incidents/trpc`. */
export async function mutateIncident<K extends IncidentMutation>(
  name: K,
  input: MutationInput<K>,
): Promise<MutationOutput<K>> {
  return COMMANDS[name](input);
}

/**
 * Who the browser acts as when Hub's ingress names no Tailscale user (local
 * and fixture runs). With a Tailscale identity the server replaces any human
 * actor with `human:<login>`, so sending the viewer itself is equivalent.
 */
export const BROWSER_ACTOR: ActorInput = {
  key: "human:browser",
  kind: "human",
  name: "Hub browser",
};

export function actingActor(viewer: ActorInput | null): ActorInput {
  return viewer ?? BROWSER_ACTOR;
}

export const incidentsKeys = {
  all: ["incidents"] as const,
  viewer: () => [...incidentsKeys.all, "viewer"] as const,
  lists: () => [...incidentsKeys.all, "list"] as const,
  list: (input: ListIncidentsInput) =>
    [...incidentsKeys.lists(), input] as const,
  detail: (ref: string) => [...incidentsKeys.all, "detail", ref] as const,
};

export function viewerQuery() {
  return queryOptions({
    queryKey: incidentsKeys.viewer(),
    queryFn: ({ signal }) =>
      query("viewer", undefined, ActorInputSchema.nullable(), signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function incidentListQuery(input: ListIncidentsInput) {
  return queryOptions({
    queryKey: incidentsKeys.list(input),
    queryFn: ({ signal }) =>
      query(
        "list",
        ListIncidentsInputSchema.parse(input),
        IncidentSummarySchema.array(),
        signal,
      ),
  });
}

export function incidentDetailQuery(ref: string) {
  return queryOptions({
    queryKey: incidentsKeys.detail(ref),
    queryFn: ({ signal }) =>
      query(
        "byRef",
        IncidentRefInputSchema.parse({ ref }),
        IncidentDetailSchema,
        signal,
      ),
  });
}

/** Search for the command palette: every incident, newest first. */
export async function fetchIncidentsForSearch(signal: AbortSignal) {
  return query(
    "list",
    ListIncidentsInputSchema.parse({ state: "all", limit: 200 }),
    IncidentSummarySchema.array(),
    signal,
  );
}
