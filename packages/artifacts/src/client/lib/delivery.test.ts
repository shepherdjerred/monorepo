import { describe, expect, test } from "vitest";
import type {
  ThreadComment,
  ThreadView,
} from "@shepherdjerred/artifacts/procedures";
import { deliveryChip, isEditable, waitingLine } from "./delivery.ts";

const human = { key: "human:jerred", kind: "human", name: "Jerred" } as const;
const agent = {
  key: "agent:karpathy",
  kind: "agent",
  name: "karpathy",
} as const;
const T0 = "2026-11-26T10:00:00.000Z";
const T1 = "2026-11-26T10:05:00.000Z";

function comment(overrides: Partial<ThreadComment> = {}): ThreadComment {
  return {
    id: "c1",
    body: "Make it bigger",
    author: human,
    createdAt: T0,
    updatedAt: T0,
    delivery: {
      state: "queued",
      actor: null,
      claimedAt: null,
      handledAt: null,
      attempts: 0,
    },
    editableUntil: null,
    ...overrides,
  };
}

function thread(
  comments: ThreadComment[],
  versionNumber: number | null = 1,
): ThreadView {
  return {
    id: "t1",
    boardId: "b1",
    artifactId: "a1",
    versionId: "v1",
    versionNumber,
    anchor: { type: "general" },
    state: "open",
    createdAt: T0,
    resolvedAt: null,
    comments,
  };
}

function delivery(state: "queued" | "claimed" | "delivered" | "handled") {
  return { state, actor: agent, claimedAt: T0, handledAt: null, attempts: 1 };
}

describe("deliveryChip", () => {
  test("Queued has no redeliver", () => {
    const chip = deliveryChip(comment(), thread([comment()]), 1);
    expect(chip).toEqual({
      label: "Queued",
      tone: "queued",
      canRedeliver: false,
    });
  });

  test("claimed and delivered name the actor and allow redelivery", () => {
    const claimed = comment({ delivery: delivery("claimed") });
    expect(deliveryChip(claimed, thread([claimed]), 1)?.label).toBe(
      "Sent to karpathy",
    );
    const delivered = comment({ delivery: delivery("delivered") });
    expect(deliveryChip(delivered, thread([delivered]), 1)).toEqual({
      label: "Delivered to karpathy",
      tone: "sent",
      canRedeliver: true,
    });
  });

  test("handled with an agent reply is Replied", () => {
    const mine = comment({ delivery: delivery("handled") });
    const reply = comment({
      id: "c2",
      author: agent,
      createdAt: T1,
      delivery: null,
    });
    expect(deliveryChip(mine, thread([mine, reply]), 1)?.label).toBe("Replied");
  });

  test("handled without a reply on a newer version is Addressed in vN", () => {
    const mine = comment({ delivery: delivery("handled") });
    expect(deliveryChip(mine, thread([mine], 1), 2)?.label).toBe(
      "Addressed in v2",
    );
  });

  test("handled on the same version without a reply is Handled", () => {
    const mine = comment({ delivery: delivery("handled") });
    expect(deliveryChip(mine, thread([mine], 2), 2)?.label).toBe("Handled");
  });

  test("an agent comment has no chip", () => {
    const reply = comment({ author: agent, delivery: null });
    expect(deliveryChip(reply, thread([reply]), 1)).toBeNull();
  });
});

const waiter = (name: string) => ({
  actor: { key: `agent:${name}`, kind: "agent", name } as const,
});

describe("waitingLine", () => {
  test("names one waiting agent", () => {
    expect(waitingLine([waiter("karpathy")], 3)).toBe("karpathy waiting");
  });

  test("counts the others", () => {
    expect(waitingLine([waiter("karpathy"), waiter("macbook")], 0)).toBe(
      "karpathy and 1 more waiting",
    );
  });

  test("says nobody is waiting and how much is queued", () => {
    expect(waitingLine([], 3)).toBe("No agent waiting · 3 queued");
    expect(waitingLine([], 0)).toBe("No agent waiting");
  });
});

describe("isEditable", () => {
  const now = Date.parse(T0);
  const open = new Date(now + 5000).toISOString();
  const closed = new Date(now - 1).toISOString();

  test("a queued human comment is editable inside its window", () => {
    expect(isEditable(comment({ editableUntil: open }), now)).toBe(true);
  });

  test("not after the window, once claimed, or for an agent", () => {
    expect(isEditable(comment({ editableUntil: closed }), now)).toBe(false);
    expect(
      isEditable(
        comment({ editableUntil: open, delivery: delivery("claimed") }),
        now,
      ),
    ).toBe(false);
    expect(
      isEditable(
        comment({ editableUntil: open, author: agent, delivery: null }),
        now,
      ),
    ).toBe(false);
  });
});
