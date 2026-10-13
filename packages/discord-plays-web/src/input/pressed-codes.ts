// The set of controls a player is holding, shared by both games' controllers.
//
// Keyboard and on-screen buttons feed the same set, and only genuine edges are
// reported: a key's auto-repeat or a second pointer on an already-held button
// is not a new press. Mario Kart turns every edge into a full controller state;
// Pokémon turns each press edge into one button tap.

export type ControlEdge = {
  readonly code: string;
  readonly down: boolean;
};

export class PressedCodes {
  private readonly held = new Set<string>();

  get codes(): ReadonlySet<string> {
    return this.held;
  }

  /** Returns the edge, or undefined when the control was already held. */
  press(code: string): ControlEdge | undefined {
    if (this.held.has(code)) return undefined;
    this.held.add(code);
    return { code, down: true };
  }

  /** Returns the edge, or undefined when the control was not held. */
  release(code: string): ControlEdge | undefined {
    return this.held.delete(code) ? { code, down: false } : undefined;
  }

  /** Release everything, e.g. when the window loses focus. */
  releaseAll(): ControlEdge[] {
    const edges = [...this.held].map((code) => ({ code, down: false }));
    this.held.clear();
    return edges;
  }
}

/**
 * True when a keyboard event is aimed at a form control or editable region.
 * Global key handlers must not act on (or preventDefault) those, or typing in
 * a text box swallows every character that is also a control binding.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
