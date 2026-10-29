import { MockActivityEnvironment } from "@temporalio/testing";
import { CancelledFailure } from "@temporalio/common";
import { expect, test } from "vitest";
import {
  mediaNetworkWorkerActivities,
  mediaFileWorkerActivities,
} from "./media.ts";

test("cancelled network activities preserve cancellation without bootstrapping credentials", async () => {
  const environment = new MockActivityEnvironment();
  environment.cancel();
  await expect(
    environment.run(mediaNetworkWorkerActivities.dispatchMediaOutbox),
  ).rejects.toBeInstanceOf(CancelledFailure);
});

test("cancelled file activities preserve cancellation before touching storage", async () => {
  const environment = new MockActivityEnvironment();
  environment.cancel();
  await expect(
    environment.run(mediaFileWorkerActivities.promoteMediaFiles, {
      operationId: "cancelled",
      attemptId: "cancelled",
    }),
  ).rejects.toBeInstanceOf(CancelledFailure);
});
