import { expect, test } from "bun:test";
import { selectNativeComparedInventory } from "./direct-effect-inventory.mjs";
const admission = { definitions: [{ id: "effect-a", supported: [0, 1] }] };
const row = (emitterIndex, extra = {}) => ({
  effectId: "effect-a",
  emitterIndex,
  frames: 121,
  mismatches: 0,
  ...extra,
});
const proof = (name, cases) => ({ name, report: { mismatches: [], cases } });

test("combined inventory deduplicates overlapping native cases and retains zero-area components", () => {
  const a = proof("camera", [row(0), row(0), row(1)]);
  a.report.visualOmissions = [
    { effectId: "effect-a", emitterIndex: 1, reason: "zero-area" },
  ];
  const selected = selectNativeComparedInventory(admission, [
    a,
    proof("motion", [row(0)]),
  ]);
  expect(selected.components).toEqual([
    {
      effectId: "effect-a",
      emitterIndex: 0,
      shaderKey: "effect-a:0",
      nativeProofs: ["camera", "motion"],
    },
    {
      effectId: "effect-a",
      emitterIndex: 1,
      shaderKey: "effect-a:1",
      nativeProofs: ["camera"],
    },
  ]);
  expect(selected.extraNativeComponentKeys).toEqual([]);
});

test("missing current native coverage fails rather than shrinking the admitted inventory", () => {
  expect(() =>
    selectNativeComparedInventory(admission, [proof("camera", [row(0)])]),
  ).toThrow("Admitted component lacks native comparison: effect-a:1");
});

test("failed, empty or malformed native controls cannot establish coverage", () => {
  for (const report of [
    { mismatches: ["different-color"], cases: [row(0), row(1)] },
    { mismatches: [], cases: [] },
    { mismatches: [], cases: [row(0), row(1, { frames: 0 })] },
    { mismatches: [], cases: [row(0), row(1, { mismatches: 1 })] },
  ])
    expect(() =>
      selectNativeComparedInventory(admission, [{ name: "native", report }]),
    ).toThrow();
});

test("duplicate admission and proof identities fail explicitly", () => {
  const verified = proof("native", [row(0), row(1)]);
  expect(() =>
    selectNativeComparedInventory(
      { definitions: [...admission.definitions, ...admission.definitions] },
      [verified],
    ),
  ).toThrow("Unique admitted definition");
  expect(() =>
    selectNativeComparedInventory(
      { definitions: [{ id: "effect-a", supported: [0, 0] }] },
      [verified],
    ),
  ).toThrow("Unique admitted emitter");
  expect(() =>
    selectNativeComparedInventory(admission, [verified, verified]),
  ).toThrow("Unique passing native comparison");
});

test("additional oracle components stay outside the admitted simulation inventory", () => {
  const selected = selectNativeComparedInventory(admission, [
    proof("native", [row(0), row(1), row(2)]),
  ]);
  expect(
    selected.components.map((component) => component.emitterIndex),
  ).toEqual([0, 1]);
  expect(selected.extraNativeComponentKeys).toEqual(["effect-a:2"]);
});
