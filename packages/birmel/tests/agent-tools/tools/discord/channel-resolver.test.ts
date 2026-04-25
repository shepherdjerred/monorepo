import { describe, test, expect } from "bun:test";
import type { Channel } from "discord.js";
import {
  describeChannelResolutionFailure,
  narrowToSendable,
  narrowToTextBased,
} from "@shepherdjerred/birmel/agent-tools/tools/discord/channel-resolver.ts";
import { z } from "zod";

/**
 * Build a stand-in for a discord.js {@link Channel} that exposes only the
 * properties the narrowing helpers consume. Validated via Zod so the cast
 * back to `Channel` reflects an actually-shaped object rather than an
 * arbitrary lie to the type system.
 */
const ChannelStubSchema = z.object({
  type: z.number(),
  isSendable: z.function(),
  isTextBased: z.function(),
});

function makeChannel(overrides: {
  type: number;
  isSendable?: boolean;
  isTextBased?: boolean;
}): Channel {
  const stub = {
    type: overrides.type,
    isSendable: () => overrides.isSendable ?? false,
    isTextBased: () => overrides.isTextBased ?? false,
  };
  ChannelStubSchema.parse(stub);
  // The narrowing helpers only call `type`, `isSendable()`, and
  // `isTextBased()`. Building a full discord.js `Channel` mock with all 60+
  // properties just to satisfy the type system is impractical; the Zod
  // parse above guarantees the shape the helpers actually consume.
  const widened: unknown = stub;
  // eslint-disable-next-line custom-rules/no-type-assertions -- third-party stub, validated above
  return widened as Channel;
}

describe("narrowToSendable", () => {
  test("returns ok for a GuildText channel", () => {
    const result = narrowToSendable(
      makeChannel({ type: 0, isSendable: true, isTextBased: true }),
    );
    expect(result.kind).toBe("ok");
  });

  test("returns ok for a public thread", () => {
    const result = narrowToSendable(
      makeChannel({ type: 11, isSendable: true, isTextBased: true }),
    );
    expect(result.kind).toBe("ok");
  });

  test("returns ok for an announcement channel", () => {
    const result = narrowToSendable(
      makeChannel({ type: 5, isSendable: true, isTextBased: true }),
    );
    expect(result.kind).toBe("ok");
  });

  test("returns ok for a DM", () => {
    const result = narrowToSendable(
      makeChannel({ type: 1, isSendable: true, isTextBased: true }),
    );
    expect(result.kind).toBe("ok");
  });

  test("returns wrong-type for a forum parent (text-based but not sendable)", () => {
    const result = narrowToSendable(
      makeChannel({ type: 15, isSendable: false, isTextBased: true }),
    );
    expect(result.kind).toBe("wrong-type");
    if (result.kind === "wrong-type") {
      expect(result.actualType).toBe("GuildForum");
    }
  });

  test("returns wrong-type for a category", () => {
    const result = narrowToSendable(
      makeChannel({ type: 4, isSendable: false, isTextBased: false }),
    );
    expect(result.kind).toBe("wrong-type");
    if (result.kind === "wrong-type") {
      expect(result.actualType).toBe("GuildCategory");
    }
  });

  test("returns not-found for null", () => {
    const result = narrowToSendable(null);
    expect(result.kind).toBe("not-found");
  });
});

describe("narrowToTextBased", () => {
  test("accepts forum/media channels (broader than sendable)", () => {
    const result = narrowToTextBased(
      makeChannel({ type: 15, isSendable: false, isTextBased: true }),
    );
    expect(result.kind).toBe("ok");
  });

  test("rejects voice without text capability", () => {
    const result = narrowToTextBased(
      makeChannel({ type: 2, isSendable: false, isTextBased: false }),
    );
    expect(result.kind).toBe("wrong-type");
  });
});

describe("describeChannelResolutionFailure", () => {
  test("renders not-found with the channel id", () => {
    expect(
      describeChannelResolutionFailure({ kind: "not-found" }, "abc"),
    ).toContain("abc");
  });

  test("renders wrong-type with the actual type label", () => {
    expect(
      describeChannelResolutionFailure(
        { kind: "wrong-type", actualType: "GuildCategory" },
        "abc",
      ),
    ).toContain("GuildCategory");
  });
});
