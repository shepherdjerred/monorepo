import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  RICH_TOOLTIP_CLOSE_DELAY,
  RICH_TOOLTIP_OPEN_DELAY,
  createLayerController,
  type LayerController,
} from "./hover-layer-controller.ts";

type Harness = {
  controller: LayerController;
  changes: boolean[];
  engagement: boolean[];
};

function harness(initialOpen = false): Harness {
  const changes: boolean[] = [];
  const engagement: boolean[] = [];
  const controller = createLayerController<ReturnType<typeof setTimeout>>({
    initialOpen,
    onOpenChange: (open) => changes.push(open),
    onEngagedChange: (engaged) => engagement.push(engaged),
    timers: {
      setTimeout: (callback, milliseconds) =>
        globalThis.setTimeout(callback, milliseconds),
      clearTimeout: (handle) => {
        globalThis.clearTimeout(handle);
      },
    },
  });
  return { controller, changes, engagement };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("layer controller", () => {
  test("hover opens only after the open delay", () => {
    const { controller, changes } = harness();
    controller.pointerTrigger(true);
    vi.advanceTimersByTime(RICH_TOOLTIP_OPEN_DELAY - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true]);
    expect(controller.isOpen()).toBe(true);
  });

  test("leaving before the delay cancels the open", () => {
    const { controller, changes } = harness();
    controller.pointerTrigger(true);
    vi.advanceTimersByTime(RICH_TOOLTIP_OPEN_DELAY - 50);
    controller.pointerTrigger(false);
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([]);
  });

  test("focus opens immediately", () => {
    const { controller, changes } = harness();
    controller.focusTrigger(true);
    expect(changes).toEqual([true]);
  });

  test("closes after the grace period, not before", () => {
    const { controller, changes } = harness();
    controller.focusTrigger(true);
    controller.focusTrigger(false);
    vi.advanceTimersByTime(RICH_TOOLTIP_CLOSE_DELAY - 1);
    expect(controller.isOpen()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true, false]);
  });

  test("moving from the trigger into the content keeps it open", () => {
    const { controller, changes } = harness();
    controller.pointerTrigger(true);
    vi.advanceTimersByTime(RICH_TOOLTIP_OPEN_DELAY);
    controller.pointerTrigger(false);
    vi.advanceTimersByTime(RICH_TOOLTIP_CLOSE_DELAY - 50);
    controller.pointerContent(true);
    vi.advanceTimersByTime(5000);
    expect(changes).toEqual([true]);
  });

  test("stays open while a descendant layer is engaged", () => {
    const { controller, changes } = harness();
    controller.focusTrigger(true);
    controller.pointerContent(true);
    controller.childEngaged("child", true);
    controller.pointerContent(false);
    vi.advanceTimersByTime(5000);
    expect(changes).toEqual([true]);
    controller.childEngaged("child", false);
    vi.advanceTimersByTime(RICH_TOOLTIP_CLOSE_DELAY);
    // Focus on the trigger still holds it.
    expect(controller.isOpen()).toBe(true);
    controller.focusTrigger(false);
    vi.advanceTimersByTime(RICH_TOOLTIP_CLOSE_DELAY);
    expect(changes).toEqual([true, false]);
  });

  test("close is immediate and forgets the content", () => {
    const { controller, changes } = harness();
    controller.pointerTrigger(true);
    vi.advanceTimersByTime(RICH_TOOLTIP_OPEN_DELAY);
    controller.pointerContent(true);
    controller.close();
    expect(changes).toEqual([true, false]);
    controller.pointerTrigger(false);
    expect(controller.isEngaged()).toBe(false);
  });

  test("reports engagement changes once each", () => {
    const { controller, engagement } = harness();
    controller.pointerTrigger(true);
    controller.pointerContent(true);
    controller.pointerTrigger(false);
    controller.pointerContent(false);
    expect(engagement).toEqual([true, false]);
  });

  test("dispose drops pending timers and reports disengagement", () => {
    const { controller, changes, engagement } = harness();
    controller.pointerTrigger(true);
    controller.dispose();
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([]);
    expect(engagement).toEqual([true, false]);
  });

  test("a layer that starts open does not close until it is engaged and left", () => {
    const { controller, changes } = harness(true);
    vi.advanceTimersByTime(5000);
    expect(changes).toEqual([]);
    controller.pointerContent(true);
    controller.pointerContent(false);
    vi.advanceTimersByTime(RICH_TOOLTIP_CLOSE_DELAY);
    expect(changes).toEqual([false]);
  });
});
