import { useCallback, useEffect, useRef, useState } from "react";
import {
  isEditableTarget,
  PressedCodes,
  type ControlEdge,
} from "./pressed-codes.ts";

export type Controls = {
  /** The held controls, as of the last edge. A fresh Set per change. */
  readonly pressedCodes: ReadonlySet<string>;
  readonly press: (code: string) => void;
  readonly release: (code: string) => void;
  readonly releaseAll: () => void;
};

/**
 * Track held controls and report every genuine press/release edge.
 *
 * `onEdge` receives the held set after the edge. It is read through a ref, so
 * passing a new function each render does not churn listeners.
 */
export function useControls(
  onEdge: (edge: ControlEdge, held: ReadonlySet<string>) => void,
): Controls {
  const pressed = useRef(new PressedCodes());
  const [pressedCodes, setPressedCodes] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const onEdgeRef = useRef(onEdge);
  onEdgeRef.current = onEdge;

  const report = useCallback((edges: ControlEdge[]) => {
    if (edges.length === 0) return;
    const held = new Set(pressed.current.codes);
    setPressedCodes(held);
    for (const edge of edges) onEdgeRef.current(edge, held);
  }, []);

  const press = useCallback(
    (code: string) => {
      const edge = pressed.current.press(code);
      if (edge !== undefined) report([edge]);
    },
    [report],
  );
  const release = useCallback(
    (code: string) => {
      const edge = pressed.current.release(code);
      if (edge !== undefined) report([edge]);
    },
    [report],
  );
  const releaseAll = useCallback(() => {
    report(pressed.current.releaseAll());
  }, [report]);

  return { pressedCodes, press, release, releaseAll };
}

/**
 * Bind the keyboard to a controller. `resolveCode` maps an event to a control
 * code, or undefined for keys the game does not use (which are left alone).
 *
 * Listeners live on window, so automation dispatching KeyboardEvents at
 * globalThis drives the same path as a person.
 */
export function useKeyboardControls(
  controls: Pick<Controls, "press" | "release" | "releaseAll">,
  resolveCode: (event: KeyboardEvent) => string | undefined,
): void {
  const { press, release, releaseAll } = controls;
  const resolveRef = useRef(resolveCode);
  resolveRef.current = resolveCode;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const code = resolveRef.current(event);
      if (code === undefined) return;
      event.preventDefault();
      press(code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      // No isEditableTarget guard: releasing a key never types anything, and
      // skipping it would leave a control stuck if focus moved to a text field
      // while the key was held.
      const code = resolveRef.current(event);
      if (code === undefined) return;
      release(code);
    };
    const onBlur = () => {
      releaseAll();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    globalThis.addEventListener("keyup", onKeyUp);
    globalThis.addEventListener("blur", onBlur);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("keyup", onKeyUp);
      globalThis.removeEventListener("blur", onBlur);
      releaseAll();
    };
  }, [press, release, releaseAll]);
}
