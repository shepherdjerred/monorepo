/**
 * The in-frame half of the host/frame protocol. The server transpiles this
 * file and injects it into every HTML document it serves, so it runs inside
 * the sandboxed iframe with an opaque origin. It is a classic script, not a
 * module: no imports, no exports, no dependencies.
 *
 * Handshake: the frame posts `{ab:1,t:"hello"}` to the app origin on every
 * load; the host answers `{ab:1,t:"init",mode,scale}` and transfers a
 * `MessagePort`. Everything after that travels over the port, so the host
 * learns identity from the port, never from a payload.
 *
 * Frame to host: drawn, scroll, wheel, gesture, key, point, nav, error.
 * Host to frame: probe, scrollTo, mode.
 */
(function bridge(): void {
  if (Reflect.get(globalThis, "__ab") === 1) return;
  Reflect.set(globalThis, "__ab", 1);

  const APP_ORIGIN = "__APP_ORIGIN__";
  const MAX_MESSAGE = 500;
  let port: MessagePort | null = null;
  let mode = "content";
  let started = false;
  let scrollQueued = false;

  /** A field of a message from the host; the payload is never trusted. */
  function field(data: unknown, key: string): unknown {
    return typeof data === "object" && data !== null
      ? Reflect.get(data, key)
      : undefined;
  }

  function send(message: Record<string, unknown>): void {
    if (port !== null) port.postMessage(message);
  }

  function docSize(): { docW: number; docH: number } {
    const root = document.documentElement;
    // A script in the head can run before the body exists.
    const body = document.querySelector("body");
    return {
      docW: Math.max(root.scrollWidth, body === null ? 0 : body.scrollWidth),
      docH: Math.max(root.scrollHeight, body === null ? 0 : body.scrollHeight),
    };
  }

  function reportDrawn(): void {
    send({ t: "drawn", ...docSize() });
  }

  const frames = (): void => {
    requestAnimationFrame(() => {
      requestAnimationFrame(reportDrawn);
    });
  };

  /** After web fonts, two frames, so the size is the settled one. */
  async function settle(): Promise<void> {
    try {
      await document.fonts.ready;
    } finally {
      frames();
    }
  }

  /** After load as well, so images and scripts have drawn. */
  function whenDrawn(): void {
    if (document.readyState === "complete") void settle();
    else
      window.addEventListener(
        "load",
        () => {
          void settle();
        },
        { once: true },
      );
  }

  function reportNav(): void {
    send({
      t: "nav",
      path: location.pathname + location.search + location.hash,
    });
  }

  function onScroll(): void {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      send({ t: "scroll", x: window.scrollX, y: window.scrollY, ...docSize() });
    });
  }

  function onWheel(event: WheelEvent): void {
    // A trackpad pinch arrives as a wheel with ctrlKey; it is always the
    // host's, so the page never zooms itself.
    if (mode === "host" || event.ctrlKey) {
      event.preventDefault();
      send({
        t: "wheel",
        dx: event.deltaX,
        dy: event.deltaY,
        ctrl: event.ctrlKey,
        x: event.clientX,
        y: event.clientY,
      });
    }
  }

  function onGesture(event: Event): void {
    const scale: unknown = Reflect.get(event, "scale");
    const x: unknown = Reflect.get(event, "clientX");
    const y: unknown = Reflect.get(event, "clientY");
    event.preventDefault();
    send({
      t: "gesture",
      scale: typeof scale === "number" ? scale : 1,
      x: typeof x === "number" ? x : 0,
      y: typeof y === "number" ? y : 0,
    });
  }

  function typing(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT")
    );
  }

  function onKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target))
      return;
    if (event.key === "Escape" || event.key === "c")
      send({ t: "key", k: event.key });
  }

  function onError(event: ErrorEvent): void {
    send({ t: "error", message: event.message.slice(0, MAX_MESSAGE) });
  }

  function onPort(event: MessageEvent): void {
    const data: unknown = event.data;
    const type = field(data, "t");
    switch (type) {
      case "probe": {
        const x = Number(field(data, "x"));
        const y = Number(field(data, "y"));
        if (Number.isFinite(x) && Number.isFinite(y))
          send({
            t: "point",
            id: field(data, "id"),
            docX: x + window.scrollX,
            docY: y + window.scrollY,
          });

        break;
      }
      case "scrollTo": {
        const x = Number(field(data, "x"));
        const y = Number(field(data, "y"));
        if (Number.isFinite(x) && Number.isFinite(y)) window.scrollTo(x, y);

        break;
      }
      case "mode": {
        mode = field(data, "mode") === "host" ? "host" : "content";

        break;
      }
      // No default
    }
  }

  function start(): void {
    if (started) return;
    started = true;
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    for (const name of ["gesturestart", "gesturechange", "gestureend"])
      globalThis.addEventListener(name, onGesture, { passive: false });
    globalThis.addEventListener("keydown", onKey);
    globalThis.addEventListener("error", onError);
    globalThis.addEventListener("hashchange", reportNav);
    // A page that draws late (a viewer, a client-rendered app) can ask again.
    globalThis.addEventListener("ab:redraw", frames);
  }

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== parent) return;
    const data: unknown = event.data;
    const next = event.ports[0];
    if (
      next === undefined ||
      field(data, "ab") !== 1 ||
      field(data, "t") !== "init"
    )
      return;
    port = next;
    mode = field(data, "mode") === "host" ? "host" : "content";
    port.addEventListener("message", onPort);
    port.start();
    start();
    reportNav();
    whenDrawn();
  });

  parent.postMessage({ ab: 1, t: "hello" }, APP_ORIGIN);
})();
