import { describe, expect, test } from "vitest";
import { splitTipText } from "#src/domain/tips/tip-text-segments.ts";
import type { TextRef } from "@scout-for-lol/data/tips/output/champion-tips.ts";

const ref = (
  key: string,
  start: number,
  end: number,
  kind: TextRef["kind"] = "ability",
): TextRef => ({ kind, key, start, end });

const text = "Land Charm first, then follow with Fox-Fire.";

describe("splitTipText", () => {
  test("a text with no reference is one plain run", () => {
    expect(splitTipText(text, [])).toEqual([{ type: "text", start: 0, text }]);
  });

  test("cuts plain runs and referenced phrases in order", () => {
    const charm = ref("Ahri-E", 5, 10);
    const foxFire = ref("Ahri-W", 35, 43);
    expect(splitTipText(text, [charm, foxFire])).toEqual([
      { type: "text", start: 0, text: "Land " },
      { type: "ref", start: 5, text: "Charm", ref: charm, repeat: false },
      { type: "text", start: 10, text: " first, then follow with " },
      { type: "ref", start: 35, text: "Fox-Fire", ref: foxFire, repeat: false },
      { type: "text", start: 43, text: "." },
    ]);
  });

  test("takes references in any order", () => {
    const charm = ref("Ahri-E", 5, 10);
    const foxFire = ref("Ahri-W", 35, 43);
    expect(splitTipText(text, [foxFire, charm])).toEqual(
      splitTipText(text, [charm, foxFire]),
    );
  });

  test("a reference can cover the whole text, or touch the next one", () => {
    const whole = ref("Ahri-E", 0, text.length);
    expect(splitTipText(text, [whole])).toEqual([
      { type: "ref", start: 0, text, ref: whole, repeat: false },
    ]);
    const left = ref("Ahri-E", 5, 10);
    const right = ref("Ahri-W", 10, 16);
    expect(
      splitTipText(text, [left, right]).map((segment) => segment.type),
    ).toEqual(["text", "ref", "ref", "text"]);
  });

  test("a span past the end of the text throws", () => {
    expect(() => splitTipText(text, [ref("Ahri-E", 40, 50)])).toThrow(
      /runs past the 44 characters/,
    );
  });

  test("overlapping spans throw", () => {
    expect(() =>
      splitTipText(text, [ref("Ahri-E", 5, 12), ref("Ahri-W", 10, 16)]),
    ).toThrow(/overlaps the one before it/);
  });

  test("marks a later mention of an entity already named as a repeat", () => {
    const repeated = "Charm, then Fox-Fire, then Charm again.";
    const refs = [
      ref("Ahri-E", 0, 5),
      ref("Ahri-W", 12, 20),
      ref("Ahri-E", 27, 32),
    ];
    const flags = splitTipText(repeated, refs).flatMap((segment) =>
      segment.type === "ref" ? [[segment.text, segment.repeat]] : [],
    );
    expect(flags).toEqual([
      ["Charm", false],
      ["Fox-Fire", false],
      ["Charm", true],
    ]);
  });

  test("the same key under another kind is a different entity", () => {
    const flags = splitTipText("Ahri and Ahri", [
      ref("Ahri", 0, 4, "champion"),
      ref("Ahri", 9, 13, "keyword"),
    ]).flatMap((segment) => (segment.type === "ref" ? [segment.repeat] : []));
    expect(flags).toEqual([false, false]);
  });

  test("a repeated span throws rather than rendering the phrase twice", () => {
    expect(() =>
      splitTipText(text, [ref("Ahri-E", 5, 10), ref("Ahri-E", 5, 10)]),
    ).toThrow(/overlaps/);
  });
});
