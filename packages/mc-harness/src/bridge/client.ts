import type { z } from "zod";
import {
  type ActorAction,
  ActorActionRequestSchemas,
  type ActorActionRequest,
  ActorActionResponseSchema,
  ActorListResponseSchema,
  ActorObservationSchema,
  ActorRemoveResponseSchema,
  ActorSchema,
  ActorSpawnRequestSchema,
  type ActorSpawnRequest,
  type Box,
  BridgeErrorSchema,
  type BridgeError,
  CommandResponseSchema,
  EventsResponseSchema,
  HealthResponseSchema,
  InfoResponseSchema,
  PlayersResponseSchema,
  RegionReadResponseSchema,
  RegistryResponseSchema,
  SnapshotListResponseSchema,
  SnapshotRestoreResponseSchema,
  SnapshotSchema,
  WePasteRequestSchema,
  WePasteResponseSchema,
  WeRunRequestSchema,
  WeRunResponseSchema,
  WeUndoRequestSchema,
  WeUndoResponseSchema,
} from "#protocol/bridge.ts";

export type BridgeEndpoint = { baseUrl: string; token: string };

const GOTO_SLACK_MS = 15_000;
const DEFAULT_GOTO_TIMEOUT_MS = 30_000;

/** A non-2xx bridge response, or one whose body broke the contract. */
export class BridgeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: BridgeError["code"] | "contract",
  ) {
    super(message);
    this.name = "BridgeRequestError";
  }
}

/**
 * Typed client for MCBridge. Every response is validated against the shared
 * zod contract, so plugin/harness skew surfaces as a `contract` error rather
 * than a silently misread field.
 */
export class BridgeClient {
  constructor(
    private readonly endpoint: BridgeEndpoint,
    private readonly timeoutMs = 120_000,
  ) {}

  health() {
    return this.json(HealthResponseSchema, "GET", "/v1/health");
  }

  info() {
    return this.json(InfoResponseSchema, "GET", "/v1/info");
  }

  registry() {
    return this.json(RegistryResponseSchema, "GET", "/v1/registry");
  }

  command(command: string) {
    return this.json(CommandResponseSchema, "POST", "/v1/command", {
      command,
    });
  }

  regionRead(box: Box) {
    return this.json(RegionReadResponseSchema, "POST", "/v1/regions/read", box);
  }

  snapshotCreate(box: Box, label?: string) {
    return this.json(SnapshotSchema, "POST", "/v1/snapshots", {
      box,
      ...(label === undefined ? {} : { label }),
    });
  }

  snapshotList() {
    return this.json(SnapshotListResponseSchema, "GET", "/v1/snapshots");
  }

  async snapshotBytes(id: string): Promise<Uint8Array> {
    const response = await this.send(
      "GET",
      `/v1/snapshots/${encodeURIComponent(id)}`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  snapshotRestore(id: string) {
    return this.json(
      SnapshotRestoreResponseSchema,
      "POST",
      `/v1/snapshots/${encodeURIComponent(id)}/restore`,
      {},
    );
  }

  weRun(request: z.input<typeof WeRunRequestSchema>) {
    return this.json(
      WeRunResponseSchema,
      "POST",
      "/v1/we/run",
      WeRunRequestSchema.parse(request),
    );
  }

  wePaste(request: z.input<typeof WePasteRequestSchema>) {
    return this.json(
      WePasteResponseSchema,
      "POST",
      "/v1/we/paste",
      WePasteRequestSchema.parse(request),
    );
  }

  weUndo(request: z.input<typeof WeUndoRequestSchema>) {
    return this.json(
      WeUndoResponseSchema,
      "POST",
      "/v1/we/undo",
      WeUndoRequestSchema.parse(request),
    );
  }

  players() {
    return this.json(PlayersResponseSchema, "GET", "/v1/players");
  }

  events(since: number, limit = 200) {
    const query = new URLSearchParams({
      since: since.toString(),
      limit: limit.toString(),
    });
    return this.json(
      EventsResponseSchema,
      "GET",
      `/v1/events?${query.toString()}`,
    );
  }

  actorSpawn(request: ActorSpawnRequest) {
    return this.json(
      ActorSchema,
      "POST",
      "/v1/actors",
      ActorSpawnRequestSchema.parse(request),
    );
  }

  actorList() {
    return this.json(ActorListResponseSchema, "GET", "/v1/actors");
  }

  actorObserve(name: string) {
    return this.json(
      ActorObservationSchema,
      "GET",
      `/v1/actors/${encodeURIComponent(name)}`,
    );
  }

  actorRemove(name: string) {
    return this.json(
      ActorRemoveResponseSchema,
      "DELETE",
      `/v1/actors/${encodeURIComponent(name)}`,
    );
  }

  actorAct<Action extends ActorAction>(
    name: string,
    action: Action,
    request: ActorActionRequest<Action>,
  ) {
    const body = ActorActionRequestSchemas[action].parse(request);
    // A goto blocks until arrival or its own timeout; outlast it.
    const timeoutMs =
      action === "goto"
        ? Math.max(
            this.timeoutMs,
            (ActorActionRequestSchemas.goto.parse(request).timeoutMs ??
              DEFAULT_GOTO_TIMEOUT_MS) + GOTO_SLACK_MS,
          )
        : this.timeoutMs;
    return this.call(ActorActionResponseSchema, {
      method: "POST",
      path: `/v1/actors/${encodeURIComponent(name)}/${action}`,
      body,
      timeoutMs,
    });
  }

  private async json<Schema extends z.ZodType>(
    schema: Schema,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<z.infer<Schema>> {
    return this.call(schema, { method, path, body, timeoutMs: this.timeoutMs });
  }

  private async call<Schema extends z.ZodType>(
    schema: Schema,
    request: {
      method: "GET" | "POST" | "DELETE";
      path: string;
      body: unknown;
      timeoutMs: number;
    },
  ): Promise<z.infer<Schema>> {
    const { method, path, body, timeoutMs } = request;
    const response = await this.send(method, path, body, timeoutMs);
    const payload: unknown = await response.json();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new BridgeRequestError(
        `${method} ${path} returned a body outside the bridge contract: ${parsed.error.message}`,
        response.status,
        "contract",
      );
    }
    return parsed.data;
  }

  private async send(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<Response> {
    const response = await fetch(`${this.endpoint.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.endpoint.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      return response;
    }
    const text = await response.text();
    let error: BridgeError | undefined;
    try {
      const parsed = BridgeErrorSchema.safeParse(JSON.parse(text));
      error = parsed.success ? parsed.data : undefined;
    } catch {
      error = undefined;
    }
    if (error === undefined) {
      throw new BridgeRequestError(
        `${method} ${path} failed with HTTP ${response.status.toString()}: ${text.slice(0, 500)}`,
        response.status,
        "contract",
      );
    }
    throw new BridgeRequestError(
      `${method} ${path}: ${error.error}`,
      response.status,
      error.code,
    );
  }
}
