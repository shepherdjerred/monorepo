/**
 * Typed client for Hub's incidents module (`/api/incidents`). Every response
 * is parsed with the incidents wire contract, so a drifted server fails
 * loudly here instead of deep inside a command.
 */
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import { timedFetch } from "#lib/trpc-link.ts";
import { z } from "zod";
import {
  ActorInputSchema,
  CheckIncidentsResultSchema,
  IncidentDetailSchema,
  IncidentErrorDataSchema,
  IncidentSummarySchema,
  TakeCommandResultSchema,
  type ActorInput,
  type CheckIncidentsInput,
  type CheckIncidentsResult,
  type DeclareIncidentInput,
  type IncidentDetail,
  type IncidentLinkInput,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentSummary,
  type IncidentSuspect,
  type IncidentSystem,
  type ListIncidentsInput,
  type TakeCommandResult,
} from "@shepherdjerred/incidents/contract";
import type { IncidentsRouter } from "@shepherdjerred/incidents/router";
import type { ActorEnvelope } from "@shepherdjerred/tracker/contract";

export const INCIDENTS_API_PATH = "/api/incidents";

/** Hub's base URL, validated like Tracker's: HTTP(S), no credentials, query, or fragment. */
export function hubBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(
      "Hub URL must be an HTTP(S) base URL without credentials, query, or fragment",
    );
  return url.toString().replace(/\/$/u, "");
}

function trpcClient(baseUrl: string, timeoutMs: number) {
  return createTRPCClient<IncidentsRouter>({
    links: [
      httpLink({
        url: `${hubBaseUrl(baseUrl)}${INCIDENTS_API_PATH}/trpc`,
        fetch: timedFetch(timeoutMs),
      }),
    ],
  });
}

type Revisioned = { ref: string; expectedRevision: number };

/** The incidents procedures toolkit uses, with contract-parsed results. */
export type IncidentsApi = {
  readonly list: (input: ListIncidentsInput) => Promise<IncidentSummary[]>;
  readonly byRef: (ref: string) => Promise<IncidentDetail>;
  readonly check: (input: CheckIncidentsInput) => Promise<CheckIncidentsResult>;
  readonly declare: (input: DeclareIncidentInput) => Promise<IncidentDetail>;
  readonly postUpdate: (
    input: Revisioned & { actor: ActorInput; body: string },
  ) => Promise<IncidentDetail>;
  readonly changeStatus: (
    input: Revisioned & {
      actor: ActorInput;
      status: IncidentStatus;
      note?: string;
    },
  ) => Promise<IncidentDetail>;
  readonly edit: (
    input: Revisioned & {
      actor: ActorInput;
      title?: string;
      summary?: string;
      impact?: string | null;
      severity?: IncidentSeverity;
      systems?: IncidentSystem[];
      components?: string[];
      exitCondition?: string;
      suspect?: IncidentSuspect | null;
    },
  ) => Promise<IncidentDetail>;
  readonly addLink: (input: {
    actor: ActorInput;
    ref: string;
    link: IncidentLinkInput;
  }) => Promise<IncidentDetail>;
  readonly join: (input: {
    actor: ActorInput;
    ref: string;
    note?: string;
  }) => Promise<IncidentDetail>;
  readonly leave: (input: {
    actor: ActorInput;
    ref: string;
    note?: string;
  }) => Promise<IncidentDetail>;
  readonly take: (input: {
    actor: ActorInput;
    ref: string;
    dispatch?: boolean;
    force?: boolean;
    note?: string;
  }) => Promise<TakeCommandResult>;
  readonly claimDispatch: (input: {
    actor: ActorInput;
    ref: string;
    dispatchToken: string;
  }) => Promise<IncidentDetail>;
  readonly releaseDispatch: (input: {
    actor: ActorInput;
    ref: string;
    dispatchToken: string;
    reason: string;
  }) => Promise<IncidentDetail>;
  readonly handoff: (
    input: Revisioned & {
      actor: ActorInput;
      to: string | null;
      note?: string;
    },
  ) => Promise<IncidentDetail>;
  readonly resolve: (
    input: Revisioned & { actor: ActorInput; note: string; force?: boolean },
  ) => Promise<IncidentDetail>;
  readonly reopen: (
    input: Revisioned & { actor: ActorInput; note: string },
  ) => Promise<IncidentDetail>;
};

async function detail(pending: Promise<unknown>): Promise<IncidentDetail> {
  return IncidentDetailSchema.parse(await pending);
}

export function incidentsApi(
  baseUrl: string,
  timeoutMs = 30_000,
): IncidentsApi {
  const client = trpcClient(baseUrl, timeoutMs);
  return {
    list: async (input) =>
      IncidentSummarySchema.array().parse(await client.list.query(input)),
    byRef: async (ref) => detail(client.byRef.query({ ref })),
    check: async (input) =>
      CheckIncidentsResultSchema.parse(await client.check.query(input)),
    declare: async (input) => detail(client.declare.mutate(input)),
    postUpdate: async (input) => detail(client.postUpdate.mutate(input)),
    changeStatus: async (input) => detail(client.changeStatus.mutate(input)),
    edit: async (input) => detail(client.edit.mutate(input)),
    addLink: async (input) => detail(client.addLink.mutate(input)),
    join: async (input) => detail(client.join.mutate(input)),
    leave: async (input) => detail(client.leave.mutate(input)),
    take: async (input) =>
      TakeCommandResultSchema.parse(await client.take.mutate(input)),
    claimDispatch: async (input) => detail(client.claimDispatch.mutate(input)),
    releaseDispatch: async (input) =>
      detail(client.releaseDispatch.mutate(input)),
    handoff: async (input) => detail(client.handoff.mutate(input)),
    resolve: async (input) => detail(client.resolve.mutate(input)),
    reopen: async (input) => detail(client.reopen.mutate(input)),
  };
}

const TrpcErrorDataSchema = z.looseObject({ code: z.string() });

/** A refusal from the incidents server, with its tRPC code and CONFLICT payload. */
export type IncidentRefusal = {
  readonly code: string;
  readonly message: string;
  readonly conflict:
    z.output<typeof IncidentErrorDataSchema>["incident"] | null;
};

/** The server's typed refusal, or null for transport and contract failures. */
export function incidentRefusal(error: unknown): IncidentRefusal | null {
  if (!(error instanceof TRPCClientError)) return null;
  const data: unknown = error.data;
  const parsed = TrpcErrorDataSchema.safeParse(data);
  if (!parsed.success) return null;
  const conflict = IncidentErrorDataSchema.safeParse(data);
  return {
    code: parsed.data.code,
    message: error.message,
    conflict: conflict.success ? conflict.data.incident : null,
  };
}

/**
 * The Tracker session envelope as an incidents actor. Incidents keeps a
 * closed metadata set, so fields it does not know are dropped here rather
 * than refused by the server.
 */
export function incidentActor(envelope: ActorEnvelope): ActorInput {
  const metadata = envelope.metadata;
  return ActorInputSchema.parse({
    key: envelope.key,
    kind: envelope.kind,
    name: envelope.name.slice(0, 120),
    metadata: {
      hostname: metadata.hostname,
      cwd: metadata.cwd,
      branch: metadata.branch,
      worktree: metadata.worktree,
      repoHead: metadata.repoHead,
      harness: metadata.harness,
      sessionId: metadata.sessionId,
      harnessVersion: metadata.harnessVersion,
      executable: metadata.executable,
      sessionLink: metadata.sessionLink,
      model: metadata.model,
      hcTerminal: metadata.hcTerminal,
      parentKey: metadata.parentKey,
      plan: metadata.plan,
    },
  });
}
