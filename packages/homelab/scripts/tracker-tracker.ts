#!/usr/bin/env bun

import { z } from "zod";
import { readConfirmationLine } from "./migration-core.ts";

const JsonObjectSchema = z.record(z.string(), z.unknown());
const JsonPayloadSchema = JsonObjectSchema.or(z.array(z.unknown()));

const TrackerInputSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.url(),
  username: z.string().min(1),
  cookies: z.string().min(1),
  userAgent: z.string().min(1),
});
export type TrackerInput = z.infer<typeof TrackerInputSchema>;

const TrackerTrackerAuthConfigSchema = z.object({
  appUrl: z.url(),
  username: z.string().min(3),
  password: z.string().min(8),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type TrackerTrackerAuthConfig = z.infer<
  typeof TrackerTrackerAuthConfigSchema
>;

const BootstrapConfigSchema = TrackerTrackerAuthConfigSchema.extend({
  qbitHost: z.string().min(1),
  qbitPort: z.number().int().positive().max(65_535),
  qbitUsername: z.string().min(1),
  qbitPassword: z.string().min(1),
  trackers: z.array(TrackerInputSchema).length(3),
});
export type BootstrapConfig = z.infer<typeof BootstrapConfigSchema>;

const TrackerRecordSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
});
const TrackerRecordsSchema = z.array(TrackerRecordSchema.loose());
const ClientRecordSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
});
const ClientRecordsSchema = z.array(ClientRecordSchema.loose());
const StatusSchema = z.object({
  configured: z.boolean(),
  authenticated: z.boolean(),
  totpEnabled: z.boolean(),
  hasUsername: z.boolean(),
});

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type TotpProvider = () => Promise<string>;

export async function readInteractiveTotp(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Tracker Tracker requires TOTP; rerun bootstrap from an interactive terminal or set TRACKER_TRACKER_TOTP",
    );
  }
  process.stderr.write("Tracker Tracker TOTP code: ");
  const code = await readConfirmationLine(Bun.stdin.stream());
  return z
    .string()
    .regex(/^\d{6}$/, "TOTP code must be exactly six digits")
    .parse(code.trim());
}

function requiredEnv(
  env: Record<string, string | undefined>,
  key: string,
): string {
  const value = env[key];
  if (value === undefined || value.length === 0)
    throw new Error(`Missing required environment variable ${key}`);
  return value;
}

function optionalEnv(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key];
  return value === undefined || value.length === 0 ? undefined : value;
}

function trackerFromEnv(
  env: Record<string, string | undefined>,
  prefix: string,
  name: string,
): TrackerInput {
  return TrackerInputSchema.parse({
    name,
    baseUrl: requiredEnv(env, `${prefix}_BASE_URL`),
    username: requiredEnv(env, `${prefix}_USERNAME`),
    cookies: requiredEnv(env, `${prefix}_COOKIES`),
    userAgent: requiredEnv(env, `${prefix}_USER_AGENT`),
  });
}

export function readBootstrapConfig(
  env: Record<string, string | undefined>,
): BootstrapConfig {
  const auth = readAuthConfig(env);
  const rawPort = env["TRACKER_TRACKER_QBIT_PORT"] ?? "8080";
  if (!/^\d+$/.test(rawPort)) {
    throw new Error("TRACKER_TRACKER_QBIT_PORT must be a positive integer");
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("TRACKER_TRACKER_QBIT_PORT must be a positive integer");
  }
  return BootstrapConfigSchema.parse({
    ...auth,
    qbitHost:
      env["TRACKER_TRACKER_QBIT_HOST"] ??
      "media-qbittorrent-service.media.svc.cluster.local",
    qbitPort: port,
    qbitUsername: requiredEnv(env, "TRACKER_TRACKER_QBIT_USERNAME"),
    qbitPassword: requiredEnv(env, "TRACKER_TRACKER_QBIT_PASSWORD"),
    trackers: [
      trackerFromEnv(env, "TRACKER_TRACKER_PRIVATEHD", "PrivateHD"),
      trackerFromEnv(env, "TRACKER_TRACKER_AVISTAZ", "AvistaZ"),
      trackerFromEnv(env, "TRACKER_TRACKER_ANIMEZ", "AnimeZ"),
    ],
  });
}

export function readAuthConfig(
  env: Record<string, string | undefined>,
): TrackerTrackerAuthConfig {
  return TrackerTrackerAuthConfigSchema.parse({
    appUrl: requiredEnv(env, "TRACKER_TRACKER_URL").replace(/\/$/, ""),
    username: requiredEnv(env, "TRACKER_TRACKER_USERNAME"),
    password: requiredEnv(env, "TRACKER_TRACKER_PASSWORD"),
    totp: optionalEnv(env, "TRACKER_TRACKER_TOTP"),
  });
}

export function buildAvistaZApiToken(tracker: TrackerInput): string {
  return JSON.stringify({
    cookies: tracker.cookies,
    userAgent: tracker.userAgent,
    username: tracker.username,
  });
}

function getSetCookieHeader(headers: Headers): string | null {
  const value = headers.get("set-cookie");
  if (value === null || value.length === 0) return null;
  const cookies = splitSetCookieHeader(value)
    .map((cookie) => cookie.split(";", 1)[0]?.trim())
    .map((cookie) => z.string().min(1).safeParse(cookie))
    .filter((result) => result.success)
    .map((result) => result.data);
  return cookies.length > 0 ? cookies.join("; ") : null;
}

function splitSetCookieHeader(value: string): string[] {
  const cookies: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== ",") continue;
    if (!/^\s*[^=;,\s]+\s*=/.test(value.slice(index + 1))) continue;
    cookies.push(value.slice(start, index));
    start = index + 1;
  }
  cookies.push(value.slice(start));
  return cookies;
}

function safeErrorMessage(body: unknown): string {
  const parsed = z.object({ error: z.string() }).safeParse(body);
  return parsed.success ? parsed.data.error : "request failed";
}

export class TrackerTrackerClient {
  private sessionCookie: string | null = null;

  public constructor(
    private readonly baseUrl: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly totpProvider: TotpProvider = readInteractiveTotp,
  ) {}

  private async call(
    path: string,
    method: "GET" | "POST" | "PATCH",
    body?: unknown,
    authenticated = true,
  ): Promise<unknown> {
    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (authenticated) {
      if (this.sessionCookie === null)
        throw new Error("Tracker Tracker session is not authenticated");
      headers.set("Cookie", this.sessionCookie);
    }
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let responseBody: unknown = null;
    if (text.trim()) {
      try {
        responseBody = JSON.parse(text);
      } catch {
        throw new Error(
          `Tracker Tracker returned non-JSON from ${method} ${path}`,
        );
      }
    }
    if (!response.ok) {
      throw new Error(
        `Tracker Tracker ${method} ${path} failed with HTTP ${String(response.status)}: ${safeErrorMessage(responseBody)}`,
      );
    }
    return { body: responseBody, headers: response.headers };
  }

  private async get(path: string): Promise<unknown> {
    const result = await this.call(path, "GET");
    return z.object({ body: z.unknown() }).parse(result).body;
  }

  private async post(path: string, body?: unknown): Promise<unknown> {
    const result = await this.call(path, "POST", body);
    return z.object({ body: z.unknown() }).parse(result).body;
  }

  private async patch(path: string, body: unknown): Promise<unknown> {
    const result = await this.call(path, "PATCH", body);
    return z.object({ body: z.unknown() }).parse(result).body;
  }

  public async authenticate(
    username: string,
    password: string,
    totp?: string,
  ): Promise<void> {
    const statusResult = await this.call(
      "/api/auth/status",
      "GET",
      undefined,
      false,
    );
    const status = StatusSchema.parse(
      z.object({ body: z.unknown() }).parse(statusResult).body,
    );
    if (!status.configured) {
      await this.call(
        "/api/auth/setup",
        "POST",
        { username, password, snapshotRetentionDays: 90 },
        false,
      );
    }

    const loginResult = await this.call(
      "/api/auth/login",
      "POST",
      { username, password },
      false,
    );
    const login = z
      .object({
        success: z.boolean().optional(),
        requiresTotp: z.boolean().optional(),
        pendingToken: z.string().optional(),
      })
      .parse(z.object({ body: z.unknown() }).parse(loginResult).body);

    if (login.requiresTotp === true) {
      if (login.pendingToken === undefined) {
        throw new Error(
          "Tracker Tracker requested TOTP without a pending token",
        );
      }
      const code = totp ?? (await this.totpProvider());
      const totpResult = await this.call(
        "/api/auth/totp/verify",
        "POST",
        { pendingToken: login.pendingToken, code },
        false,
      );
      this.sessionCookie = getSetCookieHeader(
        z.object({ headers: z.instanceof(Headers) }).parse(totpResult).headers,
      );
    } else {
      this.sessionCookie = getSetCookieHeader(
        z.object({ headers: z.instanceof(Headers) }).parse(loginResult).headers,
      );
    }
    if (this.sessionCookie === null)
      throw new Error("Tracker Tracker login returned no session cookie");
  }

  public async bootstrap(config: BootstrapConfig): Promise<BootstrapSummary> {
    await this.authenticate(config.username, config.password, config.totp);
    await this.patch("/api/settings", {
      snapshotRetentionDays: 90,
      trackerPollIntervalMinutes: 60,
    });

    const existingClients = ClientRecordsSchema.parse(
      await this.get("/api/clients"),
    );
    const existingClient = existingClients.find(
      (client) => client.name === "qBittorrent",
    );
    const clientPayload = {
      name: "qBittorrent",
      host: config.qbitHost,
      port: config.qbitPort,
      username: config.qbitUsername,
      password: config.qbitPassword,
      type: "qbittorrent",
      useSsl: false,
      pollIntervalSeconds: 300,
      isDefault: true,
    };
    const client =
      existingClient ??
      ClientRecordSchema.parse(await this.post("/api/clients", clientPayload));
    if (existingClient)
      await this.patch(`/api/clients/${String(client.id)}`, clientPayload);
    await this.post(`/api/clients/${String(client.id)}/test`);

    const existingTrackers = TrackerRecordsSchema.parse(
      await this.get("/api/trackers"),
    );
    const trackers: BootstrapSummary["trackers"] = [];
    for (const tracker of config.trackers) {
      const apiToken = buildAvistaZApiToken(tracker);
      await this.post("/api/trackers/test-connection", {
        baseUrl: tracker.baseUrl,
        apiToken,
        platformType: "avistaz",
      });
      const existingTracker = existingTrackers.find(
        (item) => item.name === tracker.name,
      );
      const saved =
        existingTracker ??
        TrackerRecordSchema.parse(
          await this.post("/api/trackers", {
            name: tracker.name,
            baseUrl: tracker.baseUrl,
            apiToken,
            platformType: "avistaz",
          }),
        );
      if (existingTracker) {
        await this.patch(`/api/trackers/${String(saved.id)}`, {
          name: tracker.name,
          baseUrl: tracker.baseUrl,
          apiToken,
          platformType: "avistaz",
        });
      }
      trackers.push({ id: saved.id, name: saved.name });
    }
    return {
      client: { id: client.id, name: client.name },
      trackers,
    };
  }

  public async export(days: number): Promise<ExportBundle> {
    const trackerRows = TrackerRecordsSchema.parse(
      await this.get("/api/trackers"),
    );
    const clientRows = ClientRecordsSchema.parse(
      await this.get("/api/clients"),
    );
    const trackers = [];
    for (const tracker of trackerRows) {
      trackers.push({
        id: tracker.id,
        name: tracker.name,
        snapshots: JsonPayloadSchema.parse(
          await this.get(
            `/api/trackers/${String(tracker.id)}/snapshots?days=${String(days)}`,
          ),
        ),
        activeTorrents: JsonPayloadSchema.parse(
          await this.get(
            `/api/trackers/${String(tracker.id)}/torrents?active=true`,
          ),
        ),
        cachedTorrents: JsonPayloadSchema.parse(
          await this.get(`/api/trackers/${String(tracker.id)}/torrents/cached`),
        ),
      });
    }
    const clients = [];
    for (const client of clientRows) {
      clients.push({
        id: client.id,
        name: client.name,
        snapshots: JsonPayloadSchema.parse(
          await this.get(`/api/clients/${String(client.id)}/snapshots`),
        ),
      });
    }
    return { generatedAt: new Date().toISOString(), trackers, clients };
  }
}

export const BootstrapSummarySchema = z.object({
  client: ClientRecordSchema,
  trackers: z.array(TrackerRecordSchema),
});
export type BootstrapSummary = z.infer<typeof BootstrapSummarySchema>;

export const ExportBundleSchema = z.object({
  generatedAt: z.iso.datetime(),
  trackers: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      snapshots: JsonPayloadSchema,
      activeTorrents: JsonPayloadSchema,
      cachedTorrents: JsonPayloadSchema,
    }),
  ),
  clients: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      snapshots: JsonPayloadSchema,
    }),
  ),
});
export type ExportBundle = z.infer<typeof ExportBundleSchema>;

export function toJsonLines(bundle: ExportBundle): string {
  const records = [
    ...bundle.trackers.map((tracker) => ({ kind: "tracker", ...tracker })),
    ...bundle.clients.map((client) => ({ kind: "client", ...client })),
  ];
  return records.map((record) => JSON.stringify(record)).join("\n");
}

export function parseExportDays(rawValue = "90"): number {
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(
      "TRACKER_TRACKER_EXPORT_DAYS must be an integer from 1 to 3650",
    );
  }
  const days = Number(rawValue);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw new Error(
      "TRACKER_TRACKER_EXPORT_DAYS must be an integer from 1 to 3650",
    );
  }
  return days;
}

async function main(): Promise<void> {
  const command = Bun.argv[2] ?? "bootstrap";
  if (command === "bootstrap") {
    const config = readBootstrapConfig(Bun.env);
    const client = new TrackerTrackerClient(config.appUrl);
    const summary = await client.bootstrap(config);
    console.log(JSON.stringify(BootstrapSummarySchema.parse(summary), null, 2));
    return;
  }
  if (command === "export") {
    const config = readAuthConfig(Bun.env);
    const client = new TrackerTrackerClient(config.appUrl);
    await client.authenticate(config.username, config.password, config.totp);
    const days = parseExportDays(Bun.env["TRACKER_TRACKER_EXPORT_DAYS"]);
    const bundle = ExportBundleSchema.parse(await client.export(days));
    const format = Bun.env["TRACKER_TRACKER_OUTPUT_FORMAT"] ?? "json";
    if (format === "json") console.log(JSON.stringify(bundle, null, 2));
    else if (format === "jsonl") console.log(toJsonLines(bundle));
    else throw new Error("TRACKER_TRACKER_OUTPUT_FORMAT must be json or jsonl");
    return;
  }
  throw new Error(`Unknown command ${command}; use bootstrap or export`);
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
