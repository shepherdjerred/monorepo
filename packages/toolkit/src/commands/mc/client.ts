import {
  type ClientAction,
  ClientActionResponseSchema,
  ClientCaptureResponseSchema,
  ClientListResponseSchema,
  type ClientStartRequest,
  ClientStatusResponseSchema,
  ClientStopResponseSchema,
} from "@shepherdjerred/mc-harness/protocol/client.ts";
import { daemonRequest, daemonSend } from "#lib/mc/client.ts";
import { renderClientStatus, renderClients } from "#lib/mc/game-client.ts";
import {
  liveWriteHeaders,
  type LiveWriteFlags,
} from "@shepherdjerred/mc-harness/protocol/live.ts";

function print<T>(json: boolean, value: T, render: (value: T) => string): void {
  console.log(json ? JSON.stringify(value, null, 2) : render(value));
}

function clientPath(name: string, rest = ""): string {
  return `/clients/${encodeURIComponent(name)}${rest}`;
}

/** The named client, or the only running one. */
export async function resolveClient(
  explicit: string | undefined,
): Promise<string> {
  if (explicit !== undefined) {
    return explicit;
  }
  const { clients } = await daemonRequest(
    ClientListResponseSchema,
    "GET",
    "/clients",
  );
  const [only] = clients;
  if (only === undefined) {
    throw new Error(
      "No client is running. Start one with: toolkit mc client start",
    );
  }
  if (clients.length > 1) {
    throw new Error(
      `Several clients are running (${clients.map((client) => client.name).join(", ")}); pass --name <name>.`,
    );
  }
  return only.name;
}

export async function mcClientStartCommand(
  start: ClientStartRequest,
  json: boolean,
  write: LiveWriteFlags = {},
): Promise<void> {
  const status = await daemonSend(
    ClientStatusResponseSchema,
    "POST",
    "/clients",
    { body: start, headers: liveWriteHeaders(write) },
  );
  print(json, status, renderClientStatus);
}

export async function mcClientListCommand(json: boolean): Promise<void> {
  const { clients } = await daemonRequest(
    ClientListResponseSchema,
    "GET",
    "/clients",
  );
  print(json, clients, renderClients);
}

export async function mcClientStatusCommand(
  name: string,
  json: boolean,
): Promise<void> {
  const status = await daemonRequest(
    ClientStatusResponseSchema,
    "GET",
    clientPath(name),
  );
  print(json, status, renderClientStatus);
}

export async function mcClientActionCommand(
  name: string,
  action: ClientAction,
  body: Record<string, unknown>,
  options: { json: boolean; write: LiveWriteFlags },
): Promise<void> {
  const result = await daemonSend(
    ClientActionResponseSchema,
    "POST",
    clientPath(name, `/${action}`),
    { body, headers: liveWriteHeaders(options.write) },
  );
  print(options.json, result, (value) => value.detail);
}

export async function mcClientCaptureCommand(
  name: string,
  out: string | undefined,
  json: boolean,
): Promise<void> {
  const result = await daemonRequest(
    ClientCaptureResponseSchema,
    "POST",
    clientPath(name, "/capture"),
    out === undefined ? {} : { out },
  );
  print(json, result, (value) => value.path);
}

export async function mcClientStopCommand(
  names: string[],
  json: boolean,
): Promise<void> {
  const stopped: string[] = [];
  for (const name of names) {
    const result = await daemonRequest(
      ClientStopResponseSchema,
      "DELETE",
      clientPath(name),
    );
    stopped.push(...result.stopped);
  }
  print(json, { stopped }, (value) =>
    value.stopped.length === 0
      ? "No clients running."
      : `Stopped ${value.stopped.join(", ")}`,
  );
}

export async function runningClientNames(): Promise<string[]> {
  const { clients } = await daemonRequest(
    ClientListResponseSchema,
    "GET",
    "/clients",
  );
  return clients.map((client) => client.name);
}
