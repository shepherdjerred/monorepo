import vm from "node:vm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildBridge } from "#server/assets.ts";

const APP = "https://app.example.test";

type Listener = (event: unknown) => void;

class FakeElement {
  isContentEditable = false;
  constructor(readonly tagName: string) {}
}

function createFrame() {
  const listeners = new Map<string, Listener[]>();
  const posted: { message: unknown; target: string }[] = [];
  const parent = {
    postMessage: (message: unknown, target: string) => {
      posted.push({ message, target });
    },
  };
  const scrolled: [number, number][] = [];
  const windowObject = {
    scrollX: 30,
    scrollY: 400,
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    scrollTo: (x: number, y: number) => {
      scrolled.push([x, y]);
    },
  };
  const documentObject = {
    readyState: "complete",
    documentElement: { scrollWidth: 1000, scrollHeight: 5000 },
    querySelector: () => ({ scrollWidth: 1200, scrollHeight: 4000 }),
    fonts: { ready: Promise.resolve() },
  };
  const portListeners: Listener[] = [];
  const toHost: unknown[] = [];
  const port = {
    addEventListener: (_type: string, listener: Listener) => {
      portListeners.push(listener);
    },
    start: vi.fn(),
    postMessage: (message: unknown) => {
      toHost.push(message);
    },
  };
  return {
    parent,
    posted,
    scrolled,
    toHost,
    window: windowObject,
    document: documentObject,
    emit: (type: string, event: unknown) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    fromHost: (data: unknown) => {
      for (const listener of portListeners) listener({ data });
    },
    port,
  };
}

let source = "";
beforeAll(async () => {
  const bridge = await buildBridge(APP);
  const asset = bridge.get("v1.js");
  source = new TextDecoder().decode(asset?.bytes);
});

function boot() {
  const frame = createFrame();
  // A script in its own context sees only what a frame would: the sandbox
  // object stands in for the window and is its global.
  const context = vm.createContext({
    window: frame.window,
    document: frame.document,
    parent: frame.parent,
    location: { pathname: "/_t/token/page.html", search: "", hash: "#/two" },
    requestAnimationFrame: (callback: () => void) => {
      callback();
    },
    HTMLElement: FakeElement,
    scrollX: frame.window.scrollX,
    addEventListener: frame.window.addEventListener,
  });
  vm.runInContext(source, context);
  return frame;
}

function init(frame: ReturnType<typeof createFrame>, mode = "content") {
  frame.emit("message", {
    source: frame.parent,
    data: { ab: 1, t: "init", mode, scale: 1 },
    ports: [frame.port],
  });
}

/** The `t` of a message the frame sent. */
function typeOf(message: unknown): unknown {
  return typeof message === "object" && message !== null
    ? Reflect.get(message, "t")
    : undefined;
}

describe("bridge (in-frame)", () => {
  it("says hello to the app origin and nowhere else", () => {
    const frame = boot();
    expect(frame.posted).toEqual([
      { message: { ab: 1, t: "hello" }, target: APP },
    ]);
    expect(source).not.toContain("__APP_ORIGIN__");
  });

  it("ignores an init from another window or without a port", () => {
    const frame = boot();
    frame.emit("message", {
      source: {},
      data: { ab: 1, t: "init" },
      ports: [frame.port],
    });
    frame.emit("message", {
      source: frame.parent,
      data: { ab: 1, t: "init" },
      ports: [],
    });
    frame.emit("message", {
      source: frame.parent,
      data: { ab: 2, t: "init" },
      ports: [frame.port],
    });
    frame.emit("message", {
      source: frame.parent,
      data: null,
      ports: [frame.port],
    });
    expect(frame.toHost).toEqual([]);
  });

  it("reports its path and, once drawn, the document size", async () => {
    const frame = boot();
    init(frame);
    await vi.waitFor(() => {
      expect(frame.toHost).toContainEqual({
        t: "drawn",
        docW: 1200,
        docH: 5000,
      });
    });
    expect(frame.toHost).toContainEqual({
      t: "nav",
      path: "/_t/token/page.html#/two",
    });
  });

  it("forwards wheels in host mode and pinches in any mode, and only those", () => {
    const frame = boot();
    init(frame, "content");
    const wheel = (extra: object) => {
      const prevented = vi.fn();
      frame.emit("wheel", {
        deltaX: 1,
        deltaY: 2,
        clientX: 3,
        clientY: 4,
        ctrlKey: false,
        preventDefault: prevented,
        ...extra,
      });
      return prevented;
    };
    const plain = wheel({});
    expect(plain).not.toHaveBeenCalled();
    const pinch = wheel({ ctrlKey: true });
    expect(pinch).toHaveBeenCalled();
    expect(frame.toHost).toContainEqual({
      t: "wheel",
      dx: 1,
      dy: 2,
      ctrl: true,
      x: 3,
      y: 4,
    });
    const before = frame.toHost.length;
    frame.fromHost({ t: "mode", mode: "host" });
    const hostWheel = wheel({});
    expect(hostWheel).toHaveBeenCalled();
    expect(frame.toHost.length).toBe(before + 1);
    frame.emit("gesturechange", {
      scale: 1.5,
      clientX: 7,
      clientY: 8,
      preventDefault: vi.fn(),
    });
    expect(frame.toHost).toContainEqual({
      t: "gesture",
      scale: 1.5,
      x: 7,
      y: 8,
    });
  });

  it("forwards Escape and c only, and not while typing or with a modifier", () => {
    const frame = boot();
    init(frame);
    const press = (key: string, extra: object = {}) => {
      frame.emit("keydown", {
        key,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: new FakeElement("DIV"),
        ...extra,
      });
    };
    press("Escape");
    press("c");
    press("x");
    press("c", { metaKey: true });
    press("c", { target: new FakeElement("TEXTAREA") });
    expect(frame.toHost.filter((message) => typeOf(message) === "key")).toEqual(
      [
        { t: "key", k: "Escape" },
        { t: "key", k: "c" },
      ],
    );
  });

  it("answers a probe with document coordinates and obeys scrollTo", () => {
    const frame = boot();
    init(frame);
    frame.fromHost({ t: "probe", id: 7, x: 10, y: 20 });
    expect(frame.toHost).toContainEqual({
      t: "point",
      id: 7,
      docX: 40,
      docY: 420,
    });
    frame.fromHost({ t: "probe", id: 8, x: "nope", y: 1 });
    expect(
      frame.toHost.filter((message) => typeOf(message) === "point"),
    ).toHaveLength(1);
    frame.fromHost({ t: "scrollTo", x: 5, y: 600 });
    frame.fromHost({ t: "scrollTo", x: Number.NaN, y: 1 });
    expect(frame.scrolled).toEqual([[5, 600]]);
  });

  it("reports script errors, truncated", () => {
    const frame = boot();
    init(frame);
    frame.emit("error", { message: "x".repeat(2000) });
    const reported = frame.toHost.find(
      (message) => typeOf(message) === "error",
    );
    expect(
      z.object({ message: z.string() }).parse(reported).message,
    ).toHaveLength(500);
  });

  it("throttles scroll reports to one per frame", () => {
    const frame = boot();
    init(frame);
    frame.emit("scroll", {});
    expect(frame.toHost).toContainEqual({
      t: "scroll",
      x: 30,
      y: 400,
      docW: 1200,
      docH: 5000,
    });
  });
});
