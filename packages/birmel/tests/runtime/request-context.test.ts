import { describe, expect, test } from "bun:test";
import {
  runWithRequestContext,
  suppressAutomaticMemoryExtraction,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";

describe("request-scoped memory extraction control", () => {
  test("retains a deletion suppression signal after the tool scope exits", async () => {
    const context: RequestContext = {
      sourceChannelId: "100",
      sourceMessageId: "200",
      guildId: "300",
      userId: "400",
    };

    await runWithRequestContext(context, async () => {
      suppressAutomaticMemoryExtraction();
      await Bun.sleep(0);
    });

    expect(context.suppressAutomaticMemoryExtraction).toBeTrue();
  });
});
