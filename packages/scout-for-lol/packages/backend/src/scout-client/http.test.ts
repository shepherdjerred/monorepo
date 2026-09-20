import { expect, test } from "vitest";
import { SCOUT_CLIENT_MAX_BATCH_BYTES } from "@scout-for-lol/data";
import { handleScoutClientRoute } from "./http.ts";

test("chunked JSON is rejected before buffering beyond the ingress limit", async () => {
  const chunkBytes = Math.floor(SCOUT_CLIENT_MAX_BATCH_BYTES / 2) + 1;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(chunkBytes));
      controller.enqueue(new Uint8Array(chunkBytes));
      controller.close();
    },
  });
  const request = new Request(
    "https://scout.invalid/api/scout-client/v1/pairings",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
  const response = await handleScoutClientRoute(request, new URL(request.url));
  expect(response?.status).toBe(413);
});
