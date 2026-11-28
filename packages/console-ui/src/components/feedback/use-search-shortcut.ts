import { useEffect, type RefObject } from "react";

/** Input types that take no typed text, so `/` is still free on them. */
const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "image",
  "reset",
  "submit",
]);

/** Surfaces that own the keyboard while focus is inside them. */
const KEYBOARD_OWNERS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"], [role="textbox"], dialog';

/** An element, or null when `target` is not one (or there is no DOM). */
function elementOf(target: EventTarget | null): HTMLElement | null {
  return typeof HTMLElement !== "undefined" && target instanceof HTMLElement
    ? target
    : null;
}

/** Whether the target types text: a text input, a textarea or an editable region. */
export function isTextField(target: EventTarget | null): boolean {
  const element = elementOf(target);
  return (
    element !== null &&
    (element.isContentEditable ||
      (element instanceof HTMLInputElement &&
        !NON_TEXT_INPUTS.has(element.type)) ||
      element instanceof HTMLTextAreaElement)
  );
}

/**
 * Whether a key press aimed at `target` belongs to that element rather than
 * to a page shortcut: text inputs, textareas, selects, contenteditable
 * regions, and anything inside a dialog, menu, listbox or combobox.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = elementOf(target);
  return (
    element !== null &&
    (isTextField(element) ||
      element instanceof HTMLSelectElement ||
      element.closest(KEYBOARD_OWNERS) !== null)
  );
}

/**
 * Focuses the referenced search input when `/` is pressed anywhere on the
 * page that is not typing. A modified `/` (Ctrl, Meta, Alt) is left alone.
 */
export function useSearchShortcut(
  ref: RefObject<HTMLInputElement | null>,
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const input = ref.current;
      if (input === null) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref]);
}
