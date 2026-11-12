import { KeyboardSensor, type KeyboardSensorProps } from "@dnd-kit/core";

/**
 * dnd-kit's KeyboardSensor adds its document keydown listener in a
 * `setTimeout` after pickup so the activating Space or Enter is not read back
 * as a drop. Browsers dispatch queued input before that timer, so an arrow
 * pressed while the pickup render is still in flight reaches the page
 * unhandled and natively scrolls the board instead of moving the card.
 *
 * This sensor holds every keydown from that gap and replays it to its original
 * target once the sensor listens, so each listener still sees each key once.
 */
export class BoardKeyboardSensor extends KeyboardSensor {
  constructor(props: KeyboardSensorProps) {
    super(props);
    const held: KeyboardEvent[] = [];
    // Window capture runs before every other listener; the activating keydown
    // is already past it.
    const hold = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      held.push(event);
    };
    globalThis.addEventListener("keydown", hold, { capture: true });
    // Timers with equal delays run in order, so the sensor listens by now.
    setTimeout(() => {
      globalThis.removeEventListener("keydown", hold, { capture: true });
      for (const event of held) {
        event.target?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: event.key,
            code: event.code,
            location: event.location,
            repeat: event.repeat,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      }
    });
  }
}
