// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { ConfirmButton } from "@shepherdjerred/streambot/web/client/room/confirm-button.tsx";
import {
  advance,
  button,
  click,
  hasButton,
  mount,
  perform,
  type Mounted,
} from "./harness.ts";

/** A Stop control whose action stays pending once confirmed, like a command in flight. */
function StopControl() {
  const [pending, setPending] = useState(false);
  return (
    <ConfirmButton
      label="Stop and clear this player"
      confirm="Stop"
      pending={pending}
      onConfirm={() => {
        setPending(true);
      }}
    >
      Stop
    </ConfirmButton>
  );
}

let view: Mounted;

beforeEach(async () => {
  vi.useFakeTimers();
  view = await mount(<StopControl />);
});

afterEach(async () => {
  await view.unmount();
  vi.useRealTimers();
});

function trigger(): HTMLButtonElement {
  return button(view.container, "Stop and clear this player");
}

async function arm() {
  trigger().focus();
  await click(trigger());
  expect(document.activeElement?.textContent).toBe("Stop");
  expect(hasButton(view.container, "Keep")).toBe(true);
}

describe("ConfirmButton focus", () => {
  test("confirming returns focus to the trigger, which stays focusable while pending", async () => {
    await arm();
    await click(document.activeElement);

    expect(document.activeElement).toBe(trigger());
    expect(trigger().disabled).toBe(false);
    expect(trigger().getAttribute("aria-disabled")).toBe("true");
    expect(trigger().getAttribute("aria-busy")).toBe("true");

    // A second press while pending does not arm it again.
    await click(trigger());
    expect(hasButton(view.container, "Keep")).toBe(false);
  });

  test("Keep returns focus to the trigger", async () => {
    await arm();
    await click(button(view.container, "Keep"));
    expect(document.activeElement).toBe(trigger());
  });

  test("the timeout disarms it and returns focus that was inside the pair", async () => {
    await arm();
    await advance(5000);
    expect(hasButton(view.container, "Keep")).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  test("the timeout leaves focus alone once it moved elsewhere", async () => {
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    await arm();
    await perform(() => {
      elsewhere.focus();
    });
    await advance(5000);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});
