import { DiscordAPIError } from "discord.js";
import { describe, expect, test } from "vitest";
import { ChannelSendError } from "#src/league/discord/channel.ts";
import { classifyChannelSendFailure } from "#src/temporal/v2/notification-delivery.ts";

/**
 * The decision table that decides whether a user can be told the same thing
 * twice.
 *
 * Every branch here turns a Discord failure into one of three durable
 * statements: the send definitely did not happen and never will (`failed`
 * terminal), it definitely did not happen and might next time (`failed`
 * retryable), or nobody knows (`unknown`). Getting the last one wrong in
 * either direction is expensive — call an ambiguous send `failed` and the
 * intent retries into a possible duplicate, call a definite failure `unknown`
 * and an operator has to go look at a channel by hand for nothing.
 *
 * These are unit tests over the classifier rather than end-to-end sends
 * because the classifier IS the contract; a test that drove a real send would
 * assert Discord's behaviour, which is not the thing that can regress here.
 */

const CHANNEL_ID = "100000000000000001";

function discordError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: "discord said no" },
    code,
    400,
    "POST",
    "https://discord.test/channels/1/messages",
    {},
  );
}

/** A failure `send` HANDLED: it knows the message did not go out. */
function handled(originalError?: unknown): ChannelSendError {
  return new ChannelSendError("handled", CHANNEL_ID, true, originalError);
}

/** A failure that came out of the send itself, after the request may have left. */
function unhandled(originalError?: unknown): ChannelSendError {
  return new ChannelSendError("unhandled", CHANNEL_ID, false, originalError);
}

describe("classifying a failed channel send", () => {
  test("a Discord permission denial is terminal", () => {
    // 50013 Missing Permissions. Retrying cannot grant a permission, and the
    // intent parks in `permission-denied` where an operator can query it —
    // which is what V2 keeps instead of v1's owner DM, since the intent row
    // carries no guild to escalate to.
    expect(classifyChannelSendFailure(handled(discordError(50_013)))).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "permission-denied" },
    });
  });

  test("missing access is a permission denial too", () => {
    // 50001 Missing Access is the same product situation wearing a different
    // code, and `isPermissionError` already treats the pair as one.
    expect(classifyChannelSendFailure(handled(discordError(50_001)))).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "permission-denied" },
    });
  });

  test.each([
    { name: "unknown channel", code: 10_003 },
    { name: "unknown guild", code: 10_004 },
  ])("$name is a missing target, not a permission problem", (scenario) => {
    // Both are terminal, but the reason has to be honest: telling an operator
    // a permission was revoked when the channel was deleted sends them to the
    // wrong screen.
    expect(
      classifyChannelSendFailure(handled(discordError(scenario.code))),
    ).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "target-not-found" },
    });
  });

  test("a handled failure Discord never labelled is a missing target", () => {
    // `send` raises this shape with no original error when it could not
    // resolve the channel at all, or resolved one it cannot post in. It is
    // still definite: nothing was sent, and nothing will be.
    expect(classifyChannelSendFailure(handled())).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "target-not-found" },
    });
  });

  test("a send that threw is unknown, never failed", () => {
    // The single most important row in the table. `permissionError: false`
    // means the send itself threw, so the request may have reached Discord and
    // posted before the response was lost. Classifying this as `failed` would
    // return the intent to `ready` and send it again — the exact duplicate the
    // whole nonce-before-send design exists to prevent.
    expect(
      classifyChannelSendFailure(unhandled(new Error("socket hang up"))),
    ).toEqual({ outcome: "unknown" });
  });

  test("an ambiguous failure carrying a permission code is still unknown", () => {
    // Deliberate: the classification turns on whether `send` HANDLED the
    // failure, not on which code it happens to carry. A permission error
    // surfacing from inside the send means the request was already in flight,
    // and no code makes that observable after the fact.
    expect(classifyChannelSendFailure(unhandled(discordError(50_013)))).toEqual(
      {
        outcome: "unknown",
      },
    );
  });
});
