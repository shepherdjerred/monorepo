import { expect, test } from "vitest";
import { COLD_START_SNAPSHOT } from "#shared/model/cold-start-contract.ts";
import { createColdStartReader } from "./store.ts";

test("the snapshot lives at one key in the homelab bucket", () => {
  expect(`s3://${COLD_START_SNAPSHOT.bucket}/${COLD_START_SNAPSHOT.key}`).toBe(
    "s3://homelab/delivery-cold-start/latest.json",
  );
});

test("without the bucket credential a restore check pauses instead of guessing", async () => {
  await expect(
    createColdStartReader({
      accessKeyId: undefined,
      secretAccessKey: "configured",
    })(),
  ).rejects.toMatchObject({ code: "PAUSED" });
});
