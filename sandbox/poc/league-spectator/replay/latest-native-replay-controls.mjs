import { createLatestNativeHudCompositor } from "./latest-native-hud-compositor.mjs";
import {
  createNativeReplayControlModel,
  nativeReplayButtonRectangles,
} from "./latest-native-replay-control-model.mjs";
import { createNativeReplayButtonInput } from "./latest-native-replay-button-input.mjs";

/** Demo-only original-art bridge. The shared player owns every SDK command. */
export async function createNativeReplayControls({
  root,
  manifest,
  supportedRates,
  command,
  initialState,
  onError,
  signal,
}) {
  signal.throwIfAborted();
  if (
    !(root instanceof HTMLElement) ||
    typeof command !== "function" ||
    typeof onError !== "function"
  )
    throw Error(
      "Owned HTML control surface and replay command boundary required",
    );
  const model = createNativeReplayControlModel(manifest, supportedRates),
    abort = new AbortController(),
    fullCanvas = document.createElement("canvas"),
    stage = document.createElement("div"),
    art = document.createElement("canvas"),
    label = document.createElement("output"),
    buttons = new Map(),
    inputs = new Map(),
    viewport = [1920, 1080],
    rectangles = nativeReplayButtonRectangles(model.buttons, viewport);
  let state = initialState,
    compositor = null,
    closed = false,
    visualKey = null;
  const close = () => {
    if (closed) return;
    closed = true;
    abort.abort();
    signal.removeEventListener("abort", close);
    for (const input of inputs.values()) input.reset();
    compositor?.close();
    compositor = null;
    root.replaceChildren();
  };
  signal.addEventListener("abort", close, { once: true });
  const fault = (error) => {
    if (!closed) {
      close();
      onError(error);
    }
  };
  try {
    const rects = [...rectangles.values()],
      left = Math.floor(Math.min(...rects.map((row) => row[0]))) - 2,
      top = Math.floor(Math.min(...rects.map((row) => row[1]))) - 2,
      width = Math.ceil(Math.max(...rects.map((row) => row[2]))) - left + 2,
      height = Math.ceil(Math.max(...rects.map((row) => row[3]))) - top + 2;
    root.classList.add("native-replay-controls");
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Playback");
    root.style.setProperty("--native-controls-width", `${width}px`);
    root.style.setProperty("--native-controls-height", `${height}px`);
    stage.className = "native-replay-controls-stage";
    art.width = width;
    art.height = height;
    art.setAttribute("aria-hidden", "true");
    stage.append(art);
    root.append(stage, label);
    const context = art.getContext("2d");
    if (!context) throw Error("Replay control artwork requires a 2D canvas");
    for (const original of model.buttons) {
      const button = document.createElement("button"),
        input = createNativeReplayButtonInput(),
        rect = rectangles.get(original.action);
      button.type = "button";
      button.dataset.nativeReplayAction = original.action;
      button.style.left = `${rect[0] - left}px`;
      button.style.top = `${rect[1] - top}px`;
      button.style.width = `${rect[2] - rect[0]}px`;
      button.style.height = `${rect[3] - rect[1]}px`;
      stage.append(button);
      buttons.set(original.action, button);
      inputs.set(original.action, input);
      const listen = (type, handle, target = button) =>
        target.addEventListener(
          type,
          (event) => {
            try {
              handle(event);
              draw();
            } catch (error) {
              fault(error);
            }
          },
          { signal: abort.signal },
        );
      listen("pointerdown", (event) =>
        input.pointerDown(event.pointerId, event.isPrimary, event.button),
      );
      listen("pointerenter", (event) =>
        input.pointerEnter(event.pointerId, event.pointerType),
      );
      listen("pointerleave", (event) => input.pointerLeave(event.pointerId));
      listen("pointerup", (event) => input.pointerEnd(event.pointerId), window);
      listen(
        "pointercancel",
        (event) => input.pointerCancel(event.pointerId),
        window,
      );
      listen("lostpointercapture", (event) =>
        input.pointerEnd(event.pointerId),
      );
      listen("keydown", (event) => input.keyDown(event.key));
      listen("keyup", (event) => input.keyUp(event.key));
      listen("blur", () => input.reset());
      listen("click", () => {
        const row = model
          .snapshot(state)
          .buttons.find((candidate) => candidate.action === original.action);
        if (!row.disabled)
          void command((active) =>
            model.execute(original.action, active),
          ).catch(fault);
      });
    }
    const reset = () => {
      for (const input of inputs.values()) input.reset();
      draw();
    };
    window.addEventListener("blur", reset, { signal: abort.signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) reset();
      },
      { signal: abort.signal },
    );
    function draw() {
      if (closed || !compositor) return;
      const current = model.snapshot(
          state,
          Object.fromEntries(
            [...inputs].map(([key, input]) => [key, input.snapshot()]),
          ),
        ),
        visibleIds = current.buttons.flatMap((row) => row.visibleIds),
        key = JSON.stringify(current);
      if (key === visualKey) return;
      compositor.draw({ width: viewport[0], height: viewport[1], visibleIds });
      context.clearRect(0, 0, width, height);
      context.drawImage(
        fullCanvas,
        left,
        top,
        width,
        height,
        0,
        0,
        width,
        height,
      );
      for (const row of current.buttons) {
        const button = buttons.get(row.action);
        button.setAttribute("aria-label", row.label);
        button.setAttribute("aria-disabled", String(row.disabled));
        button.dataset.nativeSelected = String(row.selected);
      }
      label.textContent = current.rateLabel;
      label.setAttribute("aria-label", `Playback speed ${current.rateLabel}`);
      visualKey = key;
    }
    const loaded = await createLatestNativeHudCompositor({
      canvas: fullCanvas,
      manifest: manifest.art,
    });
    if (closed) {
      loaded.close();
      signal.throwIfAborted();
      throw Error("Replay controls closed during loading");
    }
    compositor = loaded;
    signal.throwIfAborted();
    draw();
    return Object.freeze({
      update(next) {
        if (!closed) {
          state = next;
          draw();
        }
      },
      close,
    });
  } catch (error) {
    close();
    throw error;
  }
}
