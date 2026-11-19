import {
  KeyboardSensor,
  closestCorners,
  pointerWithin,
  type CollisionDetection,
  type DropAnimationFunction,
  type KeyboardCoordinateGetter,
  type KeyboardSensorProps,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { easeOut } from "#client/feedback/motion.ts";

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

export const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin({
    ...args,
    pointerCoordinates: args.pointerCoordinates ?? {
      x: args.collisionRect.left + args.collisionRect.width / 2,
      y: args.collisionRect.top + 20,
    },
  });
  if (hits.length > 0) {
    const cards = hits.filter(
      ({ id }) =>
        args.droppableContainers.find((container) => container.id === id)?.data
          .current?.["column"] !== true,
    );
    return cards.length > 0 ? cards : hits;
  }
  return closestCorners(args);
};

export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  args,
) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.code))
    return sortableKeyboardCoordinates(event, args);
  event.preventDefault();
  const { active, over, droppableContainers, droppableRects } = args.context;
  const currentState: unknown =
    over?.data.current?.["stateId"] ?? active?.data.current?.["stateId"];
  const columns = droppableContainers
    .getEnabled()
    .filter((container) => container.data.current?.["column"] === true);
  const index = columns.findIndex((container) => container.id === currentState);
  const target = columns[index + (event.code === "ArrowLeft" ? -1 : 1)];
  const rect = target === undefined ? undefined : droppableRects.get(target.id);
  return rect === undefined
    ? undefined
    : { x: rect.left + 10, y: rect.top + 50 };
};

const frame = () =>
  new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });

/**
 * The carried card settles into the slot the card now has. The drop has
 * already moved it in the cache, so this waits for that render and flies to
 * wherever the card landed, in its own column or another.
 */
export function settleInto(
  identifierOf: (id: string) => string | undefined,
): DropAnimationFunction {
  return async ({ active, dragOverlay }) => {
    await frame();
    await frame();
    const identifier = identifierOf(String(active.id));
    const target =
      identifier === undefined
        ? null
        : document.querySelector<HTMLElement>(
            `.board-card[data-row-issue="${CSS.escape(identifier)}"]`,
          );
    if (target === null) {
      return;
    }
    const from = dragOverlay.node.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const timing = {
      duration: 140,
      easing: easeOut,
      fill: "forwards",
    } as const;
    target.style.visibility = "hidden";
    const flight = dragOverlay.node.animate(
      [
        { translate: "0 0" },
        {
          translate: `${String(to.left - from.left)}px ${String(to.top - from.top)}px`,
        },
      ],
      timing,
    );
    dragOverlay.node.firstElementChild?.animate(
      [
        { rotate: "2deg", scale: "1" },
        { rotate: "0deg", scale: "1" },
      ],
      timing,
    );
    try {
      await flight.finished;
    } finally {
      target.style.visibility = "";
    }
  };
}
