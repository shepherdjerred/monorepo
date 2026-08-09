import { describe, expect, test } from "bun:test";

import {
  shouldDismissMissingTask,
  shouldPreventTaskDetailRemove,
} from "./task-detail-dismissal";

describe("task detail dismissal controller", () => {
  test("prevents an unapproved removal only while the draft is dirty", () => {
    expect(shouldPreventTaskDetailRemove(false, null)).toBe(false);
    expect(shouldPreventTaskDetailRemove(true, null)).toBe(true);
  });

  test("releases native dismissal after save or explicit discard", () => {
    expect(shouldPreventTaskDetailRemove(true, { kind: "go-back" })).toBe(
      false,
    );
    expect(
      shouldPreventTaskDetailRemove(true, {
        kind: "dispatch",
        action: { type: "GO_BACK" },
      }),
    ).toBe(false);
  });

  test("dismisses only when a previously resolved task disappears", () => {
    expect(shouldDismissMissingTask(false, false)).toBe(false);
    expect(shouldDismissMissingTask(false, true)).toBe(false);
    expect(shouldDismissMissingTask(true, true)).toBe(false);
    expect(shouldDismissMissingTask(true, false)).toBe(true);
  });
});
