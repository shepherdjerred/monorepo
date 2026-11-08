import { expect, it } from "vitest";
import { createRecorder } from "#src/capture/recording.ts";

it("reports a missed native frame instead of the subsequent marker rejection", async () => {
  let failed = false,
    cancelled = false;
  const native = (action: string): Promise<unknown> => {
    if (action === "record-status")
      return Promise.resolve({
        state: failed ? "FAILED" : "READY",
        error: failed ? "Rendered capture missed frame 17" : "",
        receipt: "",
      });
    if (action === "record-cancel") cancelled = true;
    if (action === "record-marker" && failed)
      throw new Error("Markers require an active recording");
    return Promise.resolve(null);
  };
  const record = createRecorder(
    native,
    () => {
      throw new Error("Incomplete frames must not be saved");
    },
    "/nonexistent-capture-stop",
  );
  await expect(
    record(
      {
        schema: 1,
        name: "lift",
        alt: "Lift",
        caption: "Lift",
        annotations: [],
      },
      () => {
        failed = true;
        return Promise.resolve();
      },
      6,
    ),
  ).rejects.toThrow("Rendered capture missed frame 17");
  expect(cancelled).toBe(true);
});
