import { expect, it } from "vitest";
import { sportsPng } from "#sports-png-fixture";
import { SportsSegmentDecoder } from "./segment-decoder.ts";

it("decodes worker media and releases the thread idempotently", async () => {
  const decoder = new SportsSegmentDecoder();
  const payload = new Uint8Array([71, 1, 2, 3]);
  expect(await decoder.decode(sportsPng(payload))).toEqual(payload);
  const close = decoder.close();
  expect(decoder.close()).toBe(close);
  await close;
  await expect(decoder.decode(sportsPng(payload))).rejects.toMatchObject({
    kind: "session-expired",
  });
});

it("bounds queued jobs and rejects all pending work when closed", async () => {
  const decoder = new SportsSegmentDecoder();
  const carrier = sportsPng(new Uint8Array(1_000_000));
  const jobs = Array.from({ length: 4 }, () => decoder.decode(carrier));
  const settled = Promise.allSettled(jobs);
  await expect(decoder.decode(carrier)).rejects.toMatchObject({
    kind: "unavailable",
  });
  await decoder.close();
  const results = await settled;
  expect(results.every((result) => result.status === "rejected")).toBe(true);
});
