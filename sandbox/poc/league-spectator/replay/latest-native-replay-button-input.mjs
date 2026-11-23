// HTML owns activation. This state only presents that button's owned input;
// it never synthesizes clicks or installs a second keyboard activation path.
export function createNativeReplayButtonInput() {
  const hovering = new Set();
  let pointer = null,
    inside = false,
    keyboard = null;
  return Object.freeze({
    pointerDown(id, primary, button) {
      if (primary && button === 0 && pointer === null) {
        pointer = id;
        inside = true;
      }
    },
    pointerEnter(id, kind) {
      if (kind !== "touch") hovering.add(id);
      if (pointer === id) inside = true;
    },
    pointerLeave(id) {
      hovering.delete(id);
      if (pointer === id) inside = false;
    },
    pointerEnd(id) {
      if (pointer === id) {
        pointer = null;
        inside = false;
      }
    },
    pointerCancel(id) {
      hovering.delete(id);
      if (pointer === id) {
        pointer = null;
        inside = false;
      }
    },
    keyDown(key) {
      if (keyboard === null && (key === " " || key === "Enter")) keyboard = key;
    },
    keyUp(key) {
      if (key === keyboard) keyboard = null;
    },
    reset() {
      pointer = null;
      inside = false;
      keyboard = null;
      hovering.clear();
    },
    snapshot() {
      return {
        pressed: (pointer !== null && inside) || keyboard !== null,
        hovered: hovering.size > 0,
      };
    },
  });
}
