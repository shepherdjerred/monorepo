/**
 * Rendering and network stubs for the client's DOM tests (jsdom). Components render through
 * `react-dom/client` inside `act`, `fetch` is a queue of answers the test settles by hand, and
 * `EventSource` is a fake the test drives event by event.
 */
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

export type Mounted = {
  readonly container: HTMLElement;
  readonly rerender: (node: ReactNode) => Promise<void>;
  readonly unmount: () => Promise<void>;
};

export async function mount(node: ReactNode): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
  return {
    container,
    rerender: async (next) => {
      await act(async () => {
        root.render(next);
        await Promise.resolve();
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
    },
  };
}

/** Lets resolved promises, state updates and effects finish. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1)
    await act(async () => {
      await Promise.resolve();
    });
}

/** Runs `action` (anything that updates React state) inside `act`, then lets it settle. */
export async function perform(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
  await settle();
}

/** Moves fake timers forward inside `act`. */
export async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await settle();
}

export async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement))
    throw new TypeError("Nothing to click: the element is missing");
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
  await settle();
}

export async function press(element: Element | null, key: string) {
  if (element === null) throw new Error("Nothing to press keys on");
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

/** The button whose accessible name (aria-label, else text) is `name`. */
export function button(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find(
    (candidate) =>
      (candidate.getAttribute("aria-label") ?? candidate.textContent.trim()) ===
      name,
  );
  if (found === undefined) throw new Error("No button named " + name);
  return found;
}

export function hasButton(root: ParentNode, name: string): boolean {
  return [...root.querySelectorAll("button")].some(
    (candidate) =>
      (candidate.getAttribute("aria-label") ?? candidate.textContent.trim()) ===
      name,
  );
}

export type Call = {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly body: unknown;
  readonly answer: (status: number, body: unknown) => void;
  readonly failNetwork: () => void;
};

/**
 * Stubs `fetch`: every request waits until the test answers it. An aborted request rejects the
 * way a browser does, unless it was already answered; `ignoreAbort` models a response that was
 * already on its way when the page aborted.
 */
export function stubFetch(options: { ignoreAbort?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: string, init?: RequestInit): Promise<Response> =>
      new Promise((resolve, reject) => {
        const signal = init?.signal ?? null;
        if (options.ignoreAbort !== true)
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The request was aborted.", "AbortError"));
          });
        calls.push({
          url: input,
          init,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          answer: (status, body) => {
            resolve(Response.json(body, { status }));
          },
          failNetwork: () => {
            reject(new TypeError("Failed to fetch"));
          },
        });
      }),
  );
  return calls;
}

type Listener = (event: Event) => void;

/** A fake `EventSource`; `FakeEventSource.opened` lists every stream the page opened. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];
  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.opened.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Delivers one event to the page, as the browser would. */
  async emit(type: string, event: Event) {
    await act(async () => {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
      await Promise.resolve();
    });
    await settle();
  }

  async message(type: string, data: unknown) {
    await this.emit(
      type,
      new MessageEvent(type, { data: JSON.stringify(data) }),
    );
  }

  static install() {
    FakeEventSource.opened = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  }

  static latest(): FakeEventSource {
    const source = FakeEventSource.opened.at(-1);
    if (source === undefined) throw new Error("No stream was opened");
    return source;
  }
}

export type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

export function deferred<T>(): Deferred<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  return { promise, resolve };
}
