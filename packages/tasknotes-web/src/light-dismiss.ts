function supportsClosedBy(dialog: HTMLDialogElement): boolean {
  return Reflect.has(dialog, "closedBy");
}

function keepNativeDismiss(): void {
  return;
}

export function bindLightDismiss(dialog: HTMLDialogElement): () => void {
  dialog.setAttribute("closedby", "any");
  if (supportsClosedBy(dialog)) return keepNativeDismiss;
  let pressedOutside = false;
  const outside = (event: PointerEvent) => {
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };
  const onDown = (event: PointerEvent) => {
    pressedOutside = outside(event);
  };
  const onUp = (event: PointerEvent) => {
    if (pressedOutside && outside(event)) dialog.close();
    pressedOutside = false;
  };
  dialog.addEventListener("pointerdown", onDown);
  dialog.addEventListener("pointerup", onUp);
  return () => {
    dialog.removeEventListener("pointerdown", onDown);
    dialog.removeEventListener("pointerup", onUp);
  };
}
