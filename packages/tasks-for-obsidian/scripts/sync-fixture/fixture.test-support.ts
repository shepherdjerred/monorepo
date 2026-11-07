import assert from "node:assert/strict";
import { mkdtemp, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SyncFixture } from "./server";
import { syntheticAccount } from "./contract";

export async function privateDirectory() {
  return realpath(await mkdtemp("/tmp/facet-sync-fixture-"));
}
export async function post(
  fixture: SyncFixture,
  endpoint: string,
  body: unknown,
) {
  const response = await fetch(fixture.identity.httpOrigin + endpoint, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(3000),
  });
  const value: unknown = await response.json();
  return { status: response.status, value };
}
export async function login(fixture: SyncFixture) {
  const result = await post(fixture, "/user/signin", {
    email: syntheticAccount.email,
    password: syntheticAccount.password,
    mfa: syntheticAccount.verificationCode,
  });
  assert.equal(result.status, 200);
  return z.object({ token: z.string() }).parse(result.value).token;
}
export async function pinnedV3() {
  const file = path.resolve(
    import.meta.dir,
    "../../../tasknotes-core/crates/obsidian-sync/tests/reference/protocol.json",
  );
  const bytes = await Bun.file(file).bytes();
  assert.equal(
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    "1a3e5ec8ba501ba745ab41baa57b5e2834cb16781bd374f8dd5a2100254dea13",
  );
  const fixture = z
    .object({
      transcript: z.object({
        cases: z.array(
          z.object({
            version: z.number(),
            frames: z.array(
              z.union([
                z.object({ text: z.record(z.string(), z.unknown()) }),
                z.object({ binary: z.array(z.number()) }),
              ]),
            ),
          }),
        ),
      }),
    })
    .parse(JSON.parse(new TextDecoder().decode(bytes)));
  const result = fixture.transcript.cases.find((value) => value.version === 3);
  assert.ok(result);
  return result.frames;
}

export async function openPinnedSocket(
  fixture: SyncFixture,
  device: string,
  cursor = 5,
) {
  const frames = await pinnedV3();
  const init = frames[0];
  assert.ok(init !== undefined && "text" in init);
  const socket = await FixtureSocket.open(fixture.identity.webSocketURL);
  socket.send({ ...init.text, device, version: cursor });
  z.object({ res: z.literal("ok") }).parse(await socket.json());
  return socket;
}

async function bounded<T>(work: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class FixtureSocket {
  readonly socket: WebSocket;
  private readonly closeSignal: Promise<void>;
  private readonly queue: (string | Uint8Array)[] = [];
  private pending: {
    resolve: (value: string | Uint8Array) => void;
    reject: (error: Error) => void;
  } | null = null;
  private ended = false;
  private constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.binaryType = "arraybuffer";
    this.closeSignal = new Promise((resolve) => {
      this.socket.addEventListener("close", () => {
        this.ended = true;
        this.pending?.reject(new Error("Fixture socket closed"));
        this.pending = null;
        resolve();
      });
    });
    this.socket.addEventListener("message", (event) => {
      const value: unknown = event.data;
      assert.ok(typeof value === "string" || value instanceof ArrayBuffer);
      const frame = typeof value === "string" ? value : new Uint8Array(value);
      if (this.pending === null) this.queue.push(frame);
      else {
        this.pending.resolve(frame);
        this.pending = null;
      }
    });
  }
  static async open(url: string) {
    const value = new FixtureSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        value.socket.close();
        reject(new Error("Fixture socket open deadline"));
      }, 3000);
      value.socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      value.socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Fixture socket open failed"));
        },
        { once: true },
      );
    });
    return value;
  }
  send(frame: unknown) {
    this.socket.send(JSON.stringify(frame));
  }
  binary(frame: Uint8Array) {
    this.socket.send(frame);
  }
  next(): Promise<string | Uint8Array> {
    const existing = this.queue.shift();
    if (existing !== undefined) return Promise.resolve(existing);
    assert.equal(this.pending, null);
    if (this.ended) return Promise.reject(new Error("Fixture socket closed"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error("Fixture frame deadline"));
      }, 3000);
      this.pending = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }
  async json() {
    const value = await this.next();
    assert.ok(typeof value === "string");
    const parsed: unknown = JSON.parse(value);
    return parsed;
  }
  async close() {
    this.socket.close();
    await this.closed;
  }
  get closed() {
    return bounded(this.closeSignal, "Fixture close deadline");
  }
}
