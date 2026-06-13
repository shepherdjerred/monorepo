// End-to-end plumbing test for the web controller: a real socket.io server
// (the production createSocket -> RequestSchema parse path) wired to the
// production handleRequest + SeatManager, driven by a real socket.io-client.
// A fake emulator records what reaches it, so we assert that a browser-shaped
// request actually lands as emulator.setPlayerInput with the right state — and
// that seat gating / schema validation block the things they should.
//
// No ROM or wasm needed; this runs in CI. The "input actually moves the game"
// half is covered by the manual scripts/e2e-input.ts (needs a ROM).
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { createServer, type Server as HttpServer } from "node:http";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { Subscription } from "rxjs";
import { createSocket } from "./socket.ts";
import {
  handleRequest,
  type EmulatorControls,
  type LeaderboardDeps,
} from "./dispatch.ts";
import type { LeaderboardStore } from "#src/leaderboard/store.ts";
import { SeatManager } from "#src/input/seat-manager.ts";
import { registry } from "#src/observability/metrics.ts";
import {
  EMPTY_BUTTONS,
  ResponseSchema,
  type LeaderboardEntry,
  type PlayerInputState,
  type Response,
} from "@discord-plays-mario-kart/common";

const recorded: { seat: number; state: PlayerInputState }[] = [];
const cleared: number[] = [];
const fakeEmu: EmulatorControls = {
  setPlayerInput: (seat, state) => recorded.push({ seat, state }),
  clearPlayerInput: (seat) => cleared.push(seat),
  renderFrame: () => ({ rgba: Buffer.alloc(0), width: 640, height: 0 }),
};

const overlayNames: { seat: number; name: string | null }[] = [];
const fakeEntries: LeaderboardEntry[] = [
  { name: "Jerred", wins: 3, races: 5, winRate: 0.6 },
];
const fakeStore: LeaderboardStore = {
  recordRace: () => Promise.resolve(),
  leaderboard: () => Promise.resolve(fakeEntries),
};
const fakeLeaderboard: LeaderboardDeps = {
  store: fakeStore,
  setOverlayName: (seat, name) => overlayNames.push({ seat, name }),
};

let http: HttpServer;
let seatManager: SeatManager;
let sub: Subscription;
let port: number;

beforeAll(async () => {
  http = createServer();
  seatManager = new SeatManager(4);
  const obs = createSocket({ server: http, isCorsEnabled: false });
  sub = obs.events.subscribe((event) => {
    handleRequest(event, {
      seatManager,
      emulator: fakeEmu,
      leaderboard: fakeLeaderboard,
    });
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const addr = http.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("server did not bind a TCP port");
  }
  port = addr.port;
});

beforeEach(() => {
  // Fresh seat state per test so seat reuse across tests can't race on the
  // async disconnect handler from a previous test's closed socket.
  seatManager = new SeatManager(4);
});

afterAll(() => {
  sub.unsubscribe();
  http.close();
});

async function connect(): Promise<ClientSocket> {
  const client = ioClient(`http://localhost:${String(port)}`, {
    transports: ["websocket"],
    forceNew: true,
  });
  await new Promise<void>((resolve) => client.on("connect", () => resolve()));
  return client;
}

/** Resolve with the next response of the given kind. */
function nextResponse(
  client: ClientSocket,
  kind: Response["kind"],
): Promise<Response> {
  return new Promise((resolve) => {
    const handler = (raw: unknown) => {
      const resp = ResponseSchema.parse(raw);
      if (resp.kind === kind) {
        client.off("response", handler);
        resolve(resp);
      }
    };
    client.on("response", handler);
  });
}

async function waitUntil(cond: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms)
      throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function pressState(
  overrides: Partial<PlayerInputState["buttons"]>,
  analogX = 0,
): PlayerInputState {
  return { buttons: { ...EMPTY_BUTTONS, ...overrides }, analogX, analogY: 0 };
}

// Observation count of the controller_rtt_ms histogram. The registry is shared
// across tests in this process, so callers must assert deltas, not absolutes.
async function rttSampleCount(): Promise<number> {
  const metrics = await registry.getMetricsAsJSON();
  const hist = metrics.find((m) => m.name === "controller_rtt_ms");
  if (hist === undefined) throw new Error("controller_rtt_ms not registered");
  const count = hist.values.find(
    (v) => v.metricName === "controller_rtt_ms_count",
  );
  return count?.value ?? 0;
}

describe("web controller dispatch (socket -> handleRequest -> emulator)", () => {
  it("claims a seat and routes that seat's input to the emulator", async () => {
    recorded.length = 0;
    const client = await connect();
    const seatResp = nextResponse(client, "seat");
    client.emit("request", { kind: "seat-claim", seat: 0 });
    const seat = await seatResp;
    expect(seat).toEqual({ kind: "seat", value: { seat: 0 } });

    // Exactly what app.tsx ships when you hold accelerate + steer right + start.
    const state = pressState({ a: true, start: true }, 1);
    client.emit("request", { kind: "input", seat: 0, state });

    await waitUntil(() => recorded.length > 0);
    expect(recorded.at(-1)).toEqual({ seat: 0, state });
    client.close();
  });

  it("ignores input for a seat the socket does not own", async () => {
    recorded.length = 0;
    const client = await connect();
    const seatResp = nextResponse(client, "seat");
    client.emit("request", { kind: "seat-claim", seat: 1 });
    await seatResp;

    // Owns seat 1, tries to drive seat 2 -> must be dropped.
    client.emit("request", {
      kind: "input",
      seat: 2,
      state: pressState({ a: true }),
    });
    // And a fresh client that owns no seat at all.
    const intruder = await connect();
    intruder.emit("request", {
      kind: "input",
      seat: 1,
      state: pressState({ b: true }),
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(recorded.length).toBe(0);
    client.close();
    intruder.close();
  });

  it("rejects malformed requests at the schema boundary (no crash, no input)", async () => {
    recorded.length = 0;
    const client = await connect();
    const seatResp = nextResponse(client, "seat");
    client.emit("request", { kind: "seat-claim", seat: 2 });
    await seatResp;

    client.emit("request", { kind: "input", seat: 9, state: pressState({}) }); // seat out of range
    client.emit("request", {
      kind: "input",
      seat: 2,
      state: { buttons: {}, analogX: 5, analogY: 0 },
    }); // bad state
    client.emit("request", { kind: "bogus" });

    await new Promise((r) => setTimeout(r, 150));
    expect(recorded.length).toBe(0);
    // Connection still alive and well-behaved after bad input.
    const statusResp = nextResponse(client, "status");
    client.emit("request", { kind: "status" });
    const status = await statusResp;
    expect(status.kind).toBe("status");
    client.close();
  });

  it("releasing a seat clears that player's held input", async () => {
    cleared.length = 0;
    const client = await connect();
    const claimResp = nextResponse(client, "seat");
    client.emit("request", { kind: "seat-claim", seat: 3 });
    await claimResp;

    const releaseResp = nextResponse(client, "seat");
    client.emit("request", { kind: "seat-release" });
    const release = await releaseResp;
    expect(release.value).toEqual({ seat: null });
    await waitUntil(() => cleared.includes(3));
    client.close();
  });

  it("observes a reported controller RTT in the latency histogram", async () => {
    const before = await rttSampleCount();
    const client = await connect();
    client.emit("request", { kind: "latency-report", rttMs: 42 });

    const deadline = Date.now() + 1000;
    while ((await rttSampleCount()) <= before && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(await rttSampleCount()).toBe(before + 1);
    client.close();
  });

  it("rejects out-of-range latency reports at the schema boundary", async () => {
    const before = await rttSampleCount();
    const client = await connect();
    client.emit("request", { kind: "latency-report", rttMs: -1 });
    client.emit("request", { kind: "latency-report", rttMs: "fast" });

    await new Promise((r) => setTimeout(r, 150));
    expect(await rttSampleCount()).toBe(before);
    // Connection still alive after bad reports.
    const statusResp = nextResponse(client, "status");
    client.emit("request", { kind: "status" });
    const status = await statusResp;
    expect(status.kind).toBe("status");
    client.close();
  });

  it("frees the seat (and clears input) when the socket disconnects", async () => {
    cleared.length = 0;
    const client = await connect();
    const claimResp = nextResponse(client, "seat");
    client.emit("request", { kind: "seat-claim", seat: 0 });
    await claimResp;
    expect(seatManager.occupied()[0]).toBe(true);

    client.close();
    await waitUntil(() => !seatManager.occupied()[0] && cleared.includes(0));
  });

  it("sets a name on the owned seat and broadcasts it in `seats`", async () => {
    overlayNames.length = 0;
    const client = await connect();
    const claimResp = nextResponse(client, "seat");
    client.emit("request", { kind: "seat-claim", seat: 1 });
    await claimResp;

    // Collect seats broadcasts: the claim emits one (names all null) before the
    // name-set one, so wait for the broadcast that actually carries the name.
    let namedSeats: (string | null)[] | undefined;
    client.on("response", (raw: unknown) => {
      const resp = ResponseSchema.parse(raw);
      if (resp.kind === "seats" && resp.value.names[1] === "Speedy") {
        namedSeats = resp.value.names;
      }
    });
    client.emit("request", { kind: "name-set", name: "Speedy" });
    await waitUntil(() => namedSeats !== undefined);
    expect(namedSeats?.[1]).toBe("Speedy");
    expect(overlayNames.at(-1)).toEqual({ seat: 1, name: "Speedy" });
    client.close();
  });

  it("ignores name-set from a socket that holds no seat", async () => {
    overlayNames.length = 0;
    const client = await connect();
    client.emit("request", { kind: "name-set", name: "Ghost" });
    // No seat -> the name never reaches the overlay. (Assert intent, not array
    // emptiness: a prior test's async disconnect may push a null-name cleanup.)
    await new Promise((r) => setTimeout(r, 150));
    expect(overlayNames.some((o) => o.name === "Ghost")).toBe(false);
    const statusResp = nextResponse(client, "status");
    client.emit("request", { kind: "status" });
    const status = await statusResp;
    expect(status.kind).toBe("status");
    client.close();
  });

  it("rejects a name that fails the shared schema (too long / non-ASCII)", async () => {
    overlayNames.length = 0;
    const client = await connect();
    const claimResp = nextResponse(client, "seat");
    client.emit("request", { kind: "seat-claim", seat: 2 });
    await claimResp;

    const tooLong = "x".repeat(50);
    client.emit("request", { kind: "name-set", name: tooLong });
    client.emit("request", { kind: "name-set", name: "🚗💨" });
    await new Promise((r) => setTimeout(r, 150));
    // Both dropped at the schema boundary (never reach the overlay).
    expect(
      overlayNames.some((o) => o.name === tooLong || o.name === "🚗💨"),
    ).toBe(false);
    client.close();
  });

  it("returns the leaderboard on request", async () => {
    const client = await connect();
    const lbResp = nextResponse(client, "leaderboard");
    client.emit("request", { kind: "leaderboard" });
    const lb = await lbResp;
    if (lb.kind !== "leaderboard") throw new Error("expected leaderboard");
    expect(lb.value.entries).toEqual(fakeEntries);
    client.close();
  });
});
