import { useEffect, useRef, useState } from "react";
import {
  neutralController,
  type ControllerState,
} from "@arcade/common/protocol.ts";
import { PressButton } from "@shepherdjerred/discord-plays-web/controller/press-button.tsx";
import { mergeControls } from "./input/merge.ts";
import { AnalogStick } from "./input/analog-stick.tsx";
import { mapGamepad } from "./input/gamepad.ts";
import { readKeyboard, resolveControlCode } from "./input/keyboard.ts";

type Button = ControllerState["buttons"][number];

export function Controller({
  enabled,
  send,
  n64,
}: {
  readonly enabled: boolean;
  readonly send: (state: ControllerState) => void;
  readonly n64: boolean;
}) {
  const held = useRef(new Set<Button>());
  const keyboard = useRef(new Set<string>());
  const latestSend = useRef(send);
  latestSend.current = send;
  const touch = useRef<ControllerState>(neutralController);
  const pad = useRef<ControllerState>(neutralController);
  const [pressed, setPressed] = useState<ReadonlySet<Button>>(new Set());
  const publish = () => {
    const keys = readKeyboard(keyboard.current, n64);
    const state = mergeControls(
      pad.current,
      { ...touch.current, buttons: [...held.current] },
      keys,
    );
    latestSend.current(state);
    setPressed(new Set(state.buttons));
  };
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const press = (code: string) => {
    const button = buttonCode(code);
    if (enabled && button !== undefined) {
      held.current.add(button);
      if (button === "l" || button === "r")
        touch.current = {
          ...touch.current,
          [button === "l" ? "triggerL" : "triggerR"]: 1,
        };
      publish();
    }
  };
  const release = (code: string) => {
    const button = buttonCode(code);
    if (button !== undefined) {
      held.current.delete(button);
      if (button === "l" || button === "r")
        touch.current = {
          ...touch.current,
          [button === "l" ? "triggerL" : "triggerR"]: 0,
        };
      publish();
    }
  };
  const releaseTrigger = (side: "l" | "r") => {
    touch.current = {
      ...touch.current,
      [side === "l" ? "triggerL" : "triggerR"]: 0,
    };
    publish();
  };
  useEffect(() => {
    let previous = "";
    const reset = () => {
      held.current.clear();
      keyboard.current.clear();
      pad.current = neutralController;
      touch.current = neutralController;
      previous = "";
      setPressed(new Set());
      latestSend.current(neutralController);
    };
    if (!enabled) {
      reset();
      return;
    }
    const keydown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const code = resolveControlCode(event, n64);
      if (code === undefined) return;
      event.preventDefault();
      keyboard.current.add(code);
      publishRef.current();
    };
    const keyup = (event: KeyboardEvent) => {
      const code = resolveControlCode(event, n64);
      if (code !== undefined) {
        keyboard.current.delete(code);
        publishRef.current();
      }
    };
    const visibility = () => {
      if (document.hidden) reset();
    };
    globalThis.addEventListener("keydown", keydown);
    globalThis.addEventListener("keyup", keyup);
    globalThis.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibility);
    let frame = 0;
    const poll = () => {
      const device = [...navigator.getGamepads()].find(
        (candidate) => candidate !== null,
      );
      const next = mapGamepad(device, n64);
      const serialized = JSON.stringify(next);
      if (serialized !== previous && !document.hidden && document.hasFocus()) {
        previous = serialized;
        pad.current = next;
        publishRef.current();
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(frame);
      globalThis.removeEventListener("keydown", keydown);
      globalThis.removeEventListener("keyup", keyup);
      globalThis.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibility);
      reset();
    };
  }, [enabled, n64]);
  const button = (code: Button, label: string) => (
    <PressButton
      key={code}
      code={code}
      pressed={pressed.has(code)}
      onPress={press}
      onRelease={release}
      ariaLabel={label}
      className={`control-button control-${code}`}
      disabled={!enabled}
    >
      {label}
    </PressButton>
  );
  return (
    <div className="controller">
      <div className="shoulder-controls">
        {button("l", "L")}
        {button("start", "START")}
        {button("r", "R")}
      </div>
      <div className="controller-body">
        <AnalogStick
          label="Control stick"
          x={touch.current.stickX}
          y={touch.current.stickY}
          disabled={!enabled}
          change={(x, y) => {
            touch.current = { ...touch.current, stickX: x, stickY: y };
            publish();
          }}
        />
        <div className="dpad">
          {button("up", "↑")}
          {button("left", "←")}
          {button("down", "↓")}
          {button("right", "→")}
        </div>
        <div className="action-buttons">
          {button("a", "A")}
          {button("b", "B")}
          {!n64 && button("x", "X")}
          {!n64 && button("y", "Y")}
          {button("z", "Z")}
        </div>
        {!n64 && (
          <AnalogStick
            label="C-stick"
            x={touch.current.cStickX}
            y={touch.current.cStickY}
            disabled={!enabled}
            change={(x, y) => {
              touch.current = { ...touch.current, cStickX: x, cStickY: y };
              publish();
            }}
          />
        )}
        {n64 && (
          <div className="dpad cstick">
            {button("c-up", "C↑")}
            {button("c-left", "C←")}
            {button("c-down", "C↓")}
            {button("c-right", "C→")}
          </div>
        )}
      </div>
      {!n64 && (
        <div className="analog-triggers">
          {(["l", "r"] as const).map((side) => (
            <label key={side}>
              Analog {side.toUpperCase()}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={touch.current[side === "l" ? "triggerL" : "triggerR"]}
                disabled={!enabled}
                onPointerUp={() => {
                  releaseTrigger(side);
                }}
                onPointerCancel={() => {
                  releaseTrigger(side);
                }}
                onBlur={() => {
                  releaseTrigger(side);
                }}
                onChange={(event) => {
                  touch.current = {
                    ...touch.current,
                    [side === "l" ? "triggerL" : "triggerR"]: Number(
                      event.target.value,
                    ),
                  };
                  publish();
                }}
              />
            </label>
          ))}
        </div>
      )}
      <p className="key-help">
        {n64
          ? "Accelerate: W / Space · Brake: S · Steer: A / D · Hop: Shift · Item: E / Z · D-pad: arrows"
          : "WASD / arrows · A: Space · B: Shift · L / R: Q / E · C-stick: IJKL"}{" "}
        · Gamepads supported
      </p>
    </div>
  );
}

function buttonCode(code: string): Button | undefined {
  return buttons.find((button) => button === code);
}

const buttons: readonly Button[] = [
  "a",
  "b",
  "x",
  "y",
  "z",
  "l",
  "r",
  "start",
  "up",
  "down",
  "left",
  "right",
  "c-up",
  "c-down",
  "c-left",
  "c-right",
];

export function SharedController({
  enabled,
  send,
}: {
  readonly enabled: boolean;
  readonly send: (command: string) => void;
}) {
  const [command, setCommand] = useState("");
  const tap = (code: string, label: string, className: string) => (
    <button
      className={className}
      disabled={!enabled}
      onClick={() => {
        send(code);
      }}
    >
      {label}
    </button>
  );
  const callback = useRef(send);
  callback.current = send;
  useEffect(() => {
    if (!enabled) return;
    const keys: Readonly<Record<string, string>> = {
      ArrowUp: "up",
      KeyW: "up",
      ArrowDown: "down",
      KeyS: "down",
      ArrowLeft: "left",
      KeyA: "left",
      ArrowRight: "right",
      KeyD: "right",
      KeyZ: "a",
      KeyX: "b",
      KeyQ: "lb",
      KeyE: "rb",
      Enter: "start",
      ShiftLeft: "select",
    };
    const press = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const next = keys[event.code];
      if (next === undefined || event.repeat) return;
      event.preventDefault();
      callback.current(next);
    };
    globalThis.addEventListener("keydown", press);
    return () => {
      globalThis.removeEventListener("keydown", press);
    };
  }, [enabled]);
  return (
    <div className="controller shared-controller">
      <p>Everyone in voice shares this adventure. Each press is a tap.</p>
      <div className="gba-console">
        <div className="gba-shoulders">
          {tap("lb", "L", "gba-shoulder")}
          {tap("rb", "R", "gba-shoulder")}
        </div>
        <div className="gba-body">
          <div className="gba-dpad" role="group" aria-label="Directional pad">
            {tap("up", "↑", "gba-up")}
            {tap("left", "←", "gba-left")}
            {tap("right", "→", "gba-right")}
            {tap("down", "↓", "gba-down")}
          </div>
          <div className="gba-system">
            {tap("select", "SELECT", "gba-system-button")}
            {tap("start", "START", "gba-system-button")}
          </div>
          <div className="gba-actions">
            {tap("b", "B", "gba-b")}
            {tap("a", "A", "gba-a")}
          </div>
        </div>
      </div>
      <p className="key-help">
        Arrows / WASD · A: Z · B: X · L / R: Q / E · Start: Enter · Select:
        Shift
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (enabled && command.trim()) {
            send(command.trim());
            setCommand("");
          }
        }}
      >
        <label htmlFor="chord">Send a chord</label>
        <div className="form-row">
          <input
            id="chord"
            value={command}
            onChange={(event) => {
              setCommand(event.target.value);
            }}
            placeholder="3a up"
            maxLength={1000}
            disabled={!enabled}
          />
          <button disabled={!enabled || command.trim().length === 0}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, [contenteditable=true]") !== null
  );
}
