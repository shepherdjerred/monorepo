import { useEffect, useState } from "react";
import { PressButton } from "@shepherdjerred/discord-plays-web/controller/press-button.tsx";
import {
  useControls,
  useKeyboardControls,
} from "@shepherdjerred/discord-plays-web/input/use-controls.ts";
import { KEYMAP } from "./game.ts";
import { socket } from "./socket.ts";

function sendCommand(command: string) {
  socket.emit("request", { kind: "command", value: command });
}

export function Controller({ reason }: { readonly reason: string | null }) {
  const [chord, setChord] = useState("");
  const disabled = reason !== null;
  const controls = useControls((edge) => {
    if (disabled || !edge.down) return;
    sendCommand(KEYMAP[edge.code] ?? edge.code);
  });
  useKeyboardControls(controls, (event) =>
    !disabled && KEYMAP[event.code] !== undefined ? event.code : undefined,
  );
  const { releaseAll } = controls;
  // A server policy change must release any physically held keys.
  useEffect(() => {
    if (disabled) releaseAll();
  }, [disabled, releaseAll]);
  const held = new Set(
    [...controls.pressedCodes].map((code) => KEYMAP[code] ?? code),
  );
  const button = (
    code: string,
    label: string,
    className: string,
    ariaLabel: string,
  ) => (
    <PressButton
      key={code}
      code={code}
      pressed={held.has(code)}
      onPress={controls.press}
      onRelease={controls.release}
      ariaLabel={ariaLabel}
      className={className}
      disabled={disabled}
    >
      {label}
    </PressButton>
  );
  return (
    <section className="dialog controller" aria-labelledby="controls-heading">
      <div className="section-heading">
        <h2 id="controls-heading">Take the controls</h2>
        <span>GBA</span>
      </div>
      <div className="shoulders">
        {button("lb", "L", "shoulder", "Left shoulder · Q")}
        <span>Every press is one tap</span>
        {button("rb", "R", "shoulder", "Right shoulder · E")}
      </div>
      <div className="controller-body">
        <div className="dpad" role="group" aria-label="Directional pad">
          {button("up", "▲", "direction up", "Up · W or up arrow")}
          {button("left", "◀", "direction left", "Left · A or left arrow")}
          <span className="dpad-center" aria-hidden="true">
            ✚
          </span>
          {button("right", "▶", "direction right", "Right · D or right arrow")}
          {button("down", "▼", "direction down", "Down · S or down arrow")}
        </div>
        <div className="system-buttons">
          {button("select", "SELECT", "system", "Select · Shift")}
          {button("start", "START", "system", "Start · Enter")}
        </div>
        <div className="action-buttons">
          {button("b", "B", "action action-b", "B · X")}
          {button("a", "A", "action action-a", "A · Z")}
        </div>
      </div>
      <p className="key-help">
        Arrows / WASD · A: Z · B: X · L / R: Q / E · Start: Enter · Select:
        Shift
      </p>
      <form
        className="chord-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || chord.trim().length === 0) return;
          sendCommand(chord.trim());
          setChord("");
        }}
      >
        <label htmlFor="chord">Or send a chord</label>
        <div className="chord-row">
          <input
            id="chord"
            value={chord}
            onChange={(event) => {
              setChord(event.target.value);
            }}
            placeholder="3a up"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
          />
          <button
            type="submit"
            disabled={disabled || chord.trim().length === 0}
          >
            Send
          </button>
        </div>
      </form>
      <p className="control-status" role="status">
        {reason ?? "Your turn! All players share the same game."}
      </p>
    </section>
  );
}
