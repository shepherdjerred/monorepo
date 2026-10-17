import { expect, test } from "vitest";
import { canonicalCompensationEntries } from "./canonical.ts";

test("two reversed FilePlan entries and reversed shared UUIDs retain the approved physical order without rewriting originals", () => {
  const files = [
    { assetId: "asset-a", mediaIds: ["a", "z"] },
    { assetId: "asset-b", mediaIds: ["b"] },
  ];
  const entries = [
    { predecessor: { id: "asset-b" }, entry: { mediaIds: ["b"] } },
    { predecessor: { id: "asset-a" }, entry: { mediaIds: ["z", "a"] } },
  ];
  const original = JSON.stringify(entries);
  const result = canonicalCompensationEntries(files, entries);
  expect(result.map((item) => item.file)).toEqual(files);
  expect(result.map((item) => item.entry)).toEqual([entries[1], entries[0]]);
  expect(JSON.stringify(entries)).toBe(original);
});

test("partial, duplicate and foreign membership cannot become canonical evidence", () => {
  const files = [{ assetId: "asset-a", mediaIds: ["a", "z"] }];
  for (const members of [["a"], ["a", "a"], ["a", "other"]])
    expect(() =>
      canonicalCompensationEntries(files, [
        { predecessor: { id: "asset-a" }, entry: { mediaIds: members } },
      ]),
    ).toThrow("Interrupted publication coverage changed");
  expect(() =>
    canonicalCompensationEntries(
      [...files, ...files],
      [
        { predecessor: { id: "asset-a" }, entry: { mediaIds: ["a", "z"] } },
        { predecessor: { id: "asset-a" }, entry: { mediaIds: ["a", "z"] } },
      ],
    ),
  ).toThrow("Interrupted publication coverage changed");
});
