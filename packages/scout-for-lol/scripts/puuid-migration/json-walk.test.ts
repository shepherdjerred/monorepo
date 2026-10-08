import { expect, test } from "vitest";
import { translateJsonColumnValue, translateJsonValue } from "./json-walk.ts";
import {
  ARCHIVE_COLUMNS,
  EMBEDDED_PUUID_ARCHIVE_COLUMNS,
  EXTRA_JSON_COLUMNS,
} from "./support.ts";

const old = "a".repeat(78);
const replacement = "b".repeat(78);
const unrelated = "c".repeat(78);
const map = new Map([[old, replacement]]);

test("inspection archives translate mapped tokens in nested prompts and query text", () => {
  const payload = {
    puuid: old,
    prompt: `Resolve (${old}) then compare ${unrelated}.`,
    nested: [{ query: `SELECT * WHERE puuid = '${old}'`, other: null }],
    count: 3,
  };
  for (const source of EMBEDDED_PUUID_ARCHIVE_COLUMNS) {
    expect(translateJsonColumnValue(payload, map, source)).toEqual({
      puuid: replacement,
      prompt: `Resolve (${replacement}) then compare ${unrelated}.`,
      nested: [
        { query: `SELECT * WHERE puuid = '${replacement}'`, other: null },
      ],
      count: 3,
    });
  }
  expect(payload.puuid).toBe(old);
});

test("inspection substitution requires a complete mapped token and is idempotent", () => {
  const payload = [old, unrelated, `${old}suffix`, `prefix${old}`, `(${old})`];
  const source = { table: "ExploreToolPayload", column: "payload" };
  const translated = translateJsonColumnValue(payload, map, source);
  expect(translated).toEqual([
    replacement,
    unrelated,
    `${old}suffix`,
    `prefix${old}`,
    `(${replacement})`,
  ]);
  expect(translateJsonColumnValue(translated, map, source)).toEqual(translated);
});

test("actionable payloads and structural callers retain embedded durable keys", () => {
  const payload = { puuid: old, requestedWorkflowId: `workflow:${old}:123` };
  const expected = { ...payload, puuid: replacement };
  expect(translateJsonValue(payload, map)).toEqual(expected);
  for (const source of [
    { table: "ScoutWorkflowStart", column: "inputPayload" },
    { table: "ScoutTemporalWork", column: "payload" },
    { table: "BucksDare", column: "contractJson" },
    { table: "ExploreToolPayload", column: "other" },
  ]) {
    expect(translateJsonColumnValue(payload, map, source)).toEqual(expected);
  }
});

test("every embedded-token column is explicitly discovered and classified as an archive", () => {
  for (const source of EMBEDDED_PUUID_ARCHIVE_COLUMNS) {
    expect(EXTRA_JSON_COLUMNS).toContainEqual(source);
    expect(ARCHIVE_COLUMNS).toContainEqual(source);
  }
});
