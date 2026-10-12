import { clamp } from "#lib/lines.ts";
import { required } from "#scripts/dom.ts";
const popup = required(document, "#type-popup"),
  popupText = required(popup, "pre");
let owner: HTMLElement | null = null;
let pinned = false;

function tokenAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>("[data-type]")
    : null;
}
export function closePopup(): void {
  owner?.removeAttribute("aria-describedby");
  owner = null;
  pinned = false;
  popup.hidden = true;
}
export function placePopup(): void {
  if (owner === null) return;
  if (!owner.isConnected) {
    closePopup();
    return;
  }
  const anchor = owner.getBoundingClientRect();
  const width = window.visualViewport?.width ?? innerWidth;
  const height = window.visualViewport?.height ?? innerHeight;
  popup.style.left = `${String(clamp(anchor.left, 12, Math.max(12, width - popup.offsetWidth - 12)))}px`;
  const below = anchor.bottom + 10;
  const top =
    below + popup.offsetHeight < height - 12
      ? below
      : anchor.top - popup.offsetHeight - 10;
  popup.style.top = `${String(clamp(top, 12, Math.max(12, height - popup.offsetHeight - 12)))}px`;
}
function openPopup(target: HTMLElement): void {
  const info = target.dataset.type;
  if (info === undefined) return;
  closePopup();
  owner = target;
  popupText.textContent = info;
  popup.hidden = false;
  target.setAttribute("aria-describedby", "type-popup");
  placePopup();
}
// Layout changes beneath a stationary pointer must not reopen a dismissed popup.
document.addEventListener("pointermove", (event) => {
  if (pinned || event.pointerType === "touch") return;
  const target = tokenAt(event.target);
  if (target !== null && target !== owner) openPopup(target);
});
document.addEventListener("pointerout", (event) => {
  if (pinned || tokenAt(event.target) === null) return;
  const related = event.relatedTarget;
  if (related instanceof Node && popup.contains(related)) return;
  closePopup();
});
popup.addEventListener("pointerleave", () => {
  if (!pinned) closePopup();
});
document.addEventListener("focusin", (event) => {
  const target = tokenAt(event.target);
  if (target !== null) openPopup(target);
});
document.addEventListener("focusout", () => {
  if (!pinned) closePopup();
});
document.addEventListener("click", (event) => {
  const target = tokenAt(event.target);
  if (target !== null) {
    openPopup(target);
    pinned = true;
    return;
  }
  const outside = event.target;
  if (outside instanceof Node && !popup.contains(outside)) closePopup();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePopup();
  const target = tokenAt(event.target);
  if (target !== null && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openPopup(target);
    pinned = true;
  }
});
