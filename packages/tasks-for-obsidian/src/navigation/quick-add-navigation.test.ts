import { describe, expect, test } from "bun:test";

import { createCaptureSeed } from "../domain/quick-capture-seed";
import {
  quickAddCaptureKey,
  quickAddDismissTarget,
} from "./quick-add-navigation";

describe("Quick Add navigation lifecycle", () => {
  test("changes the capture identity for a new route or external seed", () => {
    const empty = createCaptureSeed();
    const scheduled = createCaptureSeed({ scheduled: "2026-08-08" });

    expect(quickAddCaptureKey("route-1", empty)).not.toBe(
      quickAddCaptureKey("route-2", empty),
    );
    expect(quickAddCaptureKey("route-1", empty)).not.toBe(
      quickAddCaptureKey("route-1", scheduled),
    );
  });

  test("falls back to Main when a cold-start sheet has no back route", () => {
    expect(quickAddDismissTarget(true)).toBe("back");
    expect(quickAddDismissTarget(false)).toBe("main");
  });
});
