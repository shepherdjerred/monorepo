/**
 * Fails when the host side of the bridge protocol and the real in-frame
 * bridge (`src/bridge/bridge.ts`, as the content host builds and serves it)
 * stop agreeing on message names or keys. The e2e (`e2e/bridge.spec.ts`) also
 * round-trips real messages through `parseFrameMessage`.
 */
import { describe, expect, test } from "vitest";
import { buildBridge } from "#server/assets.ts";
import { FrameMessageSchema, HOST_MESSAGE_TYPES } from "./bridge-protocol.ts";

async function bridgeSource(): Promise<string> {
  const assets = await buildBridge("https://app.example");
  const asset = assets.get("v1.js");
  if (asset === undefined) throw new Error("the bridge was not built");
  return new TextDecoder().decode(asset.bytes);
}

/** Every distinct first capture group of `pattern` in `text`. */
function captures(text: string, pattern: RegExp): string[] {
  return [
    ...new Set([...text.matchAll(pattern)].flatMap((match) => match[1] ?? [])),
  ].toSorted();
}

const QUOTE = "[\"'`]";

describe("bridge protocol drift", () => {
  test("the host accepts exactly the message types the bridge sends", async () => {
    const sent = captures(
      await bridgeSource(),
      new RegExp(String.raw`send\(\{t:${QUOTE}(\w+)${QUOTE}`, "gu"),
    );
    const accepted = FrameMessageSchema.options
      .map((option) => option.shape.t.value)
      .toSorted();
    expect(sent.length).toBeGreaterThan(0);
    expect(accepted).toEqual(sent);
  });

  test("the bridge handles exactly the message types the host sends", async () => {
    const handled = captures(
      await bridgeSource(),
      new RegExp(String.raw`case${QUOTE}(\w+)${QUOTE}:`, "gu"),
    );
    expect([...HOST_MESSAGE_TYPES].toSorted()).toEqual(handled);
  });

  test("the key message carries the key as `k`, limited to Escape and c", async () => {
    const source = await bridgeSource();
    expect(source).toMatch(
      new RegExp(String.raw`t:${QUOTE}key${QUOTE},k:event\.key`, "u"),
    );
    for (const key of ["Escape", "c"])
      expect(FrameMessageSchema.safeParse({ t: "key", k: key }).success).toBe(
        true,
      );
    expect(FrameMessageSchema.safeParse({ t: "key", k: "Enter" }).success).toBe(
      false,
    );
    for (const key of ["Escape", "c"])
      expect(source).toMatch(
        new RegExp(String.raw`event\.key===${QUOTE}${key}${QUOTE}`, "u"),
      );
  });

  test("the handshake uses the hello and init names the host expects", async () => {
    const source = await bridgeSource();
    expect(source).toMatch(new RegExp(`t:${QUOTE}hello${QUOTE}`, "u"));
    expect(source).toMatch(
      new RegExp(
        String.raw`field\(data,${QUOTE}t${QUOTE}\)!==${QUOTE}init${QUOTE}`,
        "u",
      ),
    );
  });
});
