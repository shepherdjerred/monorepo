import { expect, test } from "vitest";
import { pinCandidatesForDigests } from "./pin-candidate-images.ts";

test("fresh receipts identify only actually built canonical components and exact producer source", () => {
  const digest = `sha256:${"b".repeat(64)}`;
  const source = "a".repeat(40);
  expect(
    pinCandidatesForDigests(
      {
        "shepherdjerred/temporal-worker": digest,
        "shepherdjerred/scout-for-lol": digest,
      },
      "1000042",
      source,
    ),
  ).toEqual({
    "shepherdjerred/temporal-worker": {
      version: "2.0.0-1000042",
      digest,
      gitSha: source,
    },
    "shepherdjerred/scout-for-lol": {
      version: "2.0.0-1000042",
      digest,
      gitSha: source,
    },
  });
  expect(pinCandidatesForDigests({}, "1000042", source)).toEqual({});
});

test("source-owned historical workflow slots and unknown recipes never become currentCI outputs", () => {
  for (const key of [
    "shepherdjerred/temporal-worker/workflows/stable",
    "shepherdjerred/scout-for-lol/beta",
    "foreign/arcade",
  ])
    expect(() =>
      pinCandidatesForDigests(
        { [key]: `sha256:${"a".repeat(64)}` },
        "1000042",
        "a".repeat(40),
      ),
    ).toThrow();
  expect(() => pinCandidatesForDigests({}, "bad", "a".repeat(40))).toThrow(
    "build number",
  );
  expect(() => pinCandidatesForDigests({}, "1000042", "bad")).toThrow(
    "source commit",
  );
});
