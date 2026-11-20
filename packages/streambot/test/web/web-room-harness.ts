import { expect } from "vitest";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import {
  RoomSchema,
  type WebRoom,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { webFixture } from "./web-fixture.ts";

/** The two methods of a stream reader these tests use. */
export type EventReader = {
  read: () => Promise<
    { done: false; value: Uint8Array } | { done: true; value?: undefined }
  >;
  cancel: () => Promise<void>;
};

export const ORIGIN = "http://127.0.0.1:8080";
type Fixture = ReturnType<typeof webFixture>;

export type Frame = {
  event: string;
  id: string | null;
  data: string;
  retry: string | null;
  comment: string | null;
};

export function parseFrame(block: string): Frame {
  const frame: Frame = {
    event: "message",
    id: null,
    data: "",
    retry: null,
    comment: null,
  };
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) frame.comment = line.slice(1).trim();
    else if (line.startsWith("event: ")) frame.event = line.slice(7);
    else if (line.startsWith("id: ")) frame.id = line.slice(4);
    else if (line.startsWith("data: ")) frame.data += line.slice(6);
    else if (line.startsWith("retry: ")) frame.retry = line.slice(7);
  }
  return frame;
}

/** Incremental SSE parser over a fetch body, with a deadline so a missing frame fails fast. */
export class Events {
  private buffer = "";
  readonly reader: EventReader;
  constructor(response: Response, open: EventReader[]) {
    if (response.body === null) throw new Error("Expected a stream body");
    this.reader = response.body.getReader();
    open.push(this.reader);
  }
  async next(timeoutMs = 2000): Promise<Frame | null> {
    for (;;) {
      const end = this.buffer.indexOf("\n\n");
      if (end !== -1) {
        const block = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        return parseFrame(block);
      }
      const read = await Promise.race([
        this.reader.read(),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => {
            resolve("timeout");
          }, timeoutMs),
        ),
      ]);
      if (read === "timeout") throw new Error("Timed out waiting for a frame");
      if (read.done) return null;
      this.buffer += new TextDecoder().decode(read.value);
    }
  }
  async room(): Promise<WebRoom> {
    const frame = await this.next();
    if (frame?.event !== "room") throw new Error("Expected a room frame");
    return RoomSchema.parse(JSON.parse(frame.data));
  }
  /** Read room frames until one satisfies `done`. */
  async until(done: (value: WebRoom) => boolean): Promise<WebRoom> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const value = await this.room();
      if (done(value)) return value;
    }
    throw new Error("No matching room frame");
  }
}

export function getRequest(
  fixture: Fixture,
  path: string,
  signal?: AbortSignal,
) {
  return new Request(ORIGIN + path, {
    headers: { cookie: fixture.cookie },
    ...(signal === undefined ? {} : { signal }),
  });
}

export async function connectEvents(
  fixture: Fixture,
  open: EventReader[],
  signal?: AbortSignal,
) {
  const response = await fixture.handler(
    getRequest(fixture, "/api/room/events", signal),
  );
  expect(response.status).toBe(200);
  return { response, events: new Events(response, open) };
}

export function playerOf(value: WebRoom, slot: number) {
  return value.players.find((entry) => entry.slot === slot);
}

/** Sum of the samples of one metric (or histogram `_count`/`_sum`) matching `labels`. */
export async function sample(
  name: string,
  labels: Record<string, string> = {},
): Promise<number> {
  const base = name.replace(/_(count|sum)$/u, "");
  const all = await register.getMetricsAsJSON();
  const metric = all.find((candidate) => candidate.name === base);
  return (metric?.values ?? [])
    .filter(
      (value) =>
        (name === base
          ? !("metricName" in value) || value.metricName === base
          : "metricName" in value && value.metricName === name) &&
        Object.entries(labels).every(
          ([key, want]) => value.labels[key] === want,
        ),
    )
    .reduce((total, value) => total + value.value, 0);
}
