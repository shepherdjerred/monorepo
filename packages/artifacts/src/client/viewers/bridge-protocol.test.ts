import { describe, expect, test, vi } from "vitest";
import {
  BRIDGE_RATE,
  createBridgeHost,
  createRateLimiter,
  docAnchorFromPoint,
  parseFrameMessage,
  type FrameMessage,
  type HostMessageEvent,
  type PostTarget,
} from "./bridge-protocol.ts";

describe("parseFrameMessage", () => {
  test("accepts each message the real bridge sends", () => {
    const messages: unknown[] = [
      { t: "drawn", docW: 1440, docH: 3000 },
      { t: "scroll", x: 0, y: 320, docW: 1440, docH: 3000 },
      { t: "scroll", x: 0, y: 320 },
      { t: "wheel", dx: 0, dy: 40, ctrl: true, x: 10, y: 20 },
      { t: "gesture", scale: 1.2, x: 10, y: 20 },
      { t: "key", k: "Escape" },
      { t: "key", k: "c" },
      { t: "point", id: 4, docX: 3, docY: 4 },
      { t: "error", message: "boom" },
      { t: "nav", path: "/_t/abc/pages/two.html?x=1#top" },
      { ab: 1, t: "scroll", x: 0, y: 0 },
    ];
    for (const message of messages)
      expect(parseFrameMessage(message)).not.toBeNull();
  });

  test("drops what the schema does not allow", () => {
    const hostile: unknown[] = [
      null,
      "scroll",
      { x: 0, y: 0 },
      { ab: 2, t: "scroll", x: 0, y: 0 },
      { t: "scroll", x: 0, y: 0, extra: true },
      { t: "scroll", x: "0", y: 0 },
      { t: "scroll", x: Number.NaN, y: 0 },
      { t: "scroll", x: 0, y: Number.POSITIVE_INFINITY },
      { t: "scroll", x: 0, y: 1e12 },
      { t: "key", k: "Enter" },
      { t: "key", k: "Delete" },
      { t: "key", key: "c" },
      { t: "navigate", path: "/" },
      { t: "error", message: "x".repeat(5000) },
      { t: "nav", path: "x".repeat(5000) },
      { t: "gesture", scale: 0, x: 0, y: 0 },
      { t: "wheel", dx: 1e9, dy: 0, x: 0, y: 0 },
      { t: "point", id: -1, docX: 0, docY: 0 },
      { t: "point", id: 1, docX: "0", docY: 0 },
      { t: "drawn", docW: -1, docH: 10 },
      { t: "drawn", docW: 1e9, docH: 10 },
    ];
    for (const message of hostile)
      expect(parseFrameMessage(message)).toBeNull();
  });

  test("a wheel without ctrl defaults to false", () => {
    const parsed = parseFrameMessage({ t: "wheel", dx: 0, dy: 1, x: 0, y: 0 });
    expect(parsed).toMatchObject({ ctrl: false });
  });
});

describe("createRateLimiter", () => {
  test("allows a burst, then paces to the rate", () => {
    let now = 0;
    const limiter = createRateLimiter({ perSecond: 10, burst: 5 }, () => now);
    const accepted = Array.from({ length: 8 }, () => limiter.accept());
    expect(accepted.filter(Boolean)).toHaveLength(5);
    now = 100; // one token refills per 100 ms
    expect(limiter.accept()).toBe(true);
    expect(limiter.accept()).toBe(false);
  });

  test("a flood over a second is capped near the configured rate", () => {
    let now = 0;
    const limiter = createRateLimiter(BRIDGE_RATE, () => now);
    let accepted = 0;
    for (let tick = 0; tick < 10_000; tick += 1) {
      now = tick / 10; // 10k attempts over 1000 ms
      if (limiter.accept()) accepted += 1;
    }
    expect(accepted).toBeLessThanOrEqual(
      BRIDGE_RATE.perSecond + BRIDGE_RATE.burst + 1,
    );
    expect(accepted).toBeGreaterThan(BRIDGE_RATE.perSecond);
  });
});

type Posted = {
  readonly message: unknown;
  readonly origin: string;
  readonly ports: Transferable[];
};

function setup() {
  const posted: Posted[] = [];
  const target: PostTarget = {
    postMessage(message, origin, ports) {
      posted.push({ message, origin, ports });
    },
  };
  const messages: FrameMessage[] = [];
  const connected = vi.fn();
  const host = createBridgeHost(
    { contentWindow: target },
    () => ({ mode: "focus", scale: 0.5 }),
    { onMessage: (message) => messages.push(message), onConnected: connected },
  );
  const hello = (overrides: Partial<HostMessageEvent> = {}) =>
    host.handleWindowMessage({
      source: target,
      origin: "null",
      data: { ab: 1, t: "hello" },
      ...overrides,
    });
  /** The port the host transferred to the frame on its nth hello (0-based). */
  const framePort = (index: number): MessagePort => {
    const [port] = posted[index]?.ports ?? [];
    if (!(port instanceof MessagePort))
      throw new TypeError("no port transferred");
    return port;
  };
  return { posted, messages, connected, host, hello, framePort };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("createBridgeHost", () => {
  test("answers hello from the frame's own window with init and a port", () => {
    const { posted, hello, connected, host, framePort } = setup();
    expect(hello()).toBe(true);
    expect(connected).toHaveBeenCalledOnce();
    expect(host.connected()).toBe(true);
    expect(posted[0]?.message).toEqual({
      ab: 1,
      t: "init",
      mode: "focus",
      scale: 0.5,
    });
    expect(posted[0]?.origin).toBe("*");
    expect(posted[0]?.ports).toHaveLength(1);
    framePort(0).close();
    host.dispose();
  });

  test("ignores a hello from another window, a real origin, or a bad payload", () => {
    const { posted, hello, host } = setup();
    expect(hello({ source: {} })).toBe(false);
    expect(hello({ source: null })).toBe(false);
    expect(hello({ origin: "https://evil.example" })).toBe(false);
    expect(hello({ data: { ab: 1, t: "hello", extra: 1 } })).toBe(false);
    expect(hello({ data: { ab: 1, t: "init" } })).toBe(false);
    expect(posted).toHaveLength(0);
    expect(host.connected()).toBe(false);
  });

  test("delivers validated port messages and drops invalid ones", async () => {
    const { hello, messages, host, framePort } = setup();
    hello();
    const port = framePort(0);
    port.postMessage({ t: "scroll", x: 0, y: 200 });
    port.postMessage({ t: "scroll", x: 0, y: "far" });
    port.postMessage({ t: "key", k: "Enter" });
    port.postMessage({ t: "key", k: "c" });
    await settle();
    expect(messages).toEqual([
      { t: "scroll", x: 0, y: 200 },
      { t: "key", k: "c" },
    ]);
    host.dispose();
    port.close();
  });

  test("a second hello replaces the port, so the old one is ignored", async () => {
    const { hello, messages, host, framePort } = setup();
    hello();
    hello();
    const first = framePort(0);
    const second = framePort(1);
    first.postMessage({ ab: 1, t: "scroll", x: 1, y: 1 });
    second.postMessage({ ab: 1, t: "scroll", x: 2, y: 2 });
    await settle();
    expect(messages).toEqual([{ ab: 1, t: "scroll", x: 2, y: 2 }]);
    host.dispose();
    first.close();
    second.close();
  });

  test("a flooding frame is cut off at the rate limit", async () => {
    const { hello, messages, host, framePort } = setup();
    hello();
    const port = framePort(0);
    for (let step = 0; step < 1000; step += 1)
      port.postMessage({ ab: 1, t: "scroll", x: 0, y: step });
    await settle();
    expect(messages.length).toBeLessThan(1000);
    expect(messages.length).toBeGreaterThan(0);
    host.dispose();
    port.close();
  });
});

describe("docAnchorFromPoint", () => {
  const answer = { t: "point", id: 1, docX: 720, docY: 2500 } as const;

  test("turns a probe answer into a doc anchor using the last reported width", () => {
    expect(
      docAnchorFromPoint(answer, { width: 1440, path: "pages/two.html" }, 1000),
    ).toEqual({
      type: "doc",
      path: "pages/two.html",
      x: 0.5,
      y: 2500,
      docWidth: 1440,
    });
  });

  test("falls back to the viewport width before the frame reported a size", () => {
    expect(
      docAnchorFromPoint(answer, { width: 0, path: "index.html" }, 1440),
    ).toMatchObject({ x: 0.5, docWidth: 1440 });
  });

  test("clamps an answer outside the document", () => {
    const outside = { t: "point", id: 1, docX: 99_999, docY: -5 } as const;
    expect(
      docAnchorFromPoint(outside, { width: 1000, path: "index.html" }, 1000),
    ).toMatchObject({ x: 1, y: 0 });
  });
});
