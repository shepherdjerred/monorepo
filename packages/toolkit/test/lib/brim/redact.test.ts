import { describe, expect, test } from "vitest";
import {
  countByKind,
  findSecrets,
  redactBytes,
  redactJsonStrings,
} from "#lib/brim/sync/redact.ts";

// Low-entropy stand-ins assembled at run time; none is a real credential.
const anthropic = `sk-ant-api03-${"a".repeat(90)}`;
const openai = `sk-proj-${"b".repeat(120)}`;
const linear = `lin_api_${"c".repeat(40)}`;
const jwt = [
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
  Buffer.from('{"sub":"fixture","iat":1}').toString("base64url"),
  "d".repeat(43),
].join(".");

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe("findSecrets", () => {
  test("finds each standalone kind at its byte offset", () => {
    const input = `key=${anthropic} "${openai}" ${linear}\nAuthorization: Bearer ${jwt}`;
    const matches = findSecrets(bytes(input));
    expect(countByKind(matches)).toEqual({
      "anthropic-key": 1,
      "openai-key": 1,
      "linear-key": 1,
      jwt: 1,
    });
    for (const match of matches) {
      const value = input.slice(match.offset, match.offset + match.length);
      expect([anthropic, openai, linear, jwt]).toContain(value);
    }
  });

  test("ignores matches embedded in longer tokens such as base64 blobs", () => {
    const blob = `QUJD+${openai}=/xyz`;
    expect(findSecrets(bytes(`"encrypted_content":"${blob}"`))).toEqual([]);
    expect(findSecrets(bytes(`${linear}9`))).toEqual([]);
    expect(findSecrets(bytes(`sk-proj-${"e".repeat(241)}`))).toEqual([]);
    expect(findSecrets(bytes(`_${anthropic}`))).toEqual([]);
    expect(findSecrets(bytes(`${anthropic}=`))).toEqual([]);
  });

  test("treats a JSON escape before a secret as a boundary at any depth", () => {
    const once = JSON.stringify({ content: `line\n${openai}\t${linear}` });
    const twice = JSON.stringify({ body: once });
    for (const input of [once, twice]) {
      expect(countByKind(findSecrets(bytes(input)))).toEqual({
        "openai-key": 1,
        "linear-key": 1,
      });
    }
    expect(findSecrets(bytes(String.raw`\u00e9${linear}`))).toHaveLength(1);
    expect(findSecrets(bytes(String.raw`\u0041${linear}`))).toEqual([]);
    expect(findSecrets(bytes(`n${linear}`))).toEqual([]);
  });

  test("accepts a JWT only when header and payload decode to JSON objects", () => {
    expect(findSecrets(bytes(jwt))).toHaveLength(1);
    expect(findSecrets(bytes("eyJhbGciOi.eyJzdWIi.signature"))).toEqual([]);
    const arrayPayload = [
      Buffer.from('{"alg":"none"}').toString("base64url"),
      Buffer.from("[1,2]").toString("base64url"),
      "sig",
    ].join(".");
    expect(arrayPayload.startsWith("eyJ")).toBe(true);
    expect(findSecrets(bytes(arrayPayload))).toEqual([]);
  });

  test("counts offsets in bytes, not characters", () => {
    const prefix = "héllo ✓ ";
    const [match] = findSecrets(bytes(`${prefix}${linear}`));
    expect(match?.offset).toBe(bytes(prefix).length);
  });
});

describe("redactBytes", () => {
  test("overwrites with a same-length marker and keeps JSONL valid", () => {
    const lines = [
      JSON.stringify({ type: "user", message: { content: `use ${openai}` } }),
      JSON.stringify({
        type: "tool",
        output: `ANTHROPIC_API_KEY=${anthropic}`,
      }),
      JSON.stringify({ type: "tool", output: `token ${jwt} and ${linear}` }),
    ].join("\n");
    const input = bytes(`${lines}\n`);
    const result = redactBytes(input);
    expect(result.bytes.length).toBe(input.length);
    expect(result.matches).toHaveLength(4);
    const output = text(result.bytes);
    for (const secret of [anthropic, openai, linear, jwt]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("REDACTED-openai-key");
    expect(output).toContain("REDACTED-jwt");
    for (const line of output.trimEnd().split("\n")) {
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
    expect(findSecrets(result.bytes)).toEqual([]);
  });

  test("returns the input untouched when nothing matches", () => {
    const input = bytes('{"type":"user","message":"nothing secret"}\n');
    const result = redactBytes(input);
    expect(result.bytes).toBe(input);
    expect(result.matches).toEqual([]);
  });
});

describe("redactJsonStrings", () => {
  const begin = "-----BEGIN PRIVATE KEY-----";
  const end = "-----END PRIVATE KEY-----";

  test("never pairs PEM armor across records (AI-567)", () => {
    const records = [
      JSON.stringify({ type: "user", text: `docs mention ${begin} here` }),
      JSON.stringify({ type: "assistant", text: "an unrelated record" }),
      JSON.stringify({ type: "user", text: `and ${end} there` }),
    ];
    const input = bytes(`${records.join("\n")}\n`);
    // Whole-text matching pairs the BEGIN in record 1 with the END in record 3.
    expect(countByKind(findSecrets(input))).toEqual({ "private-key": 1 });
    const result = redactJsonStrings(input);
    expect(result.matches).toEqual([]);
    expect(text(result.bytes).split("\n").slice(0, 3)).toEqual(records);
  });

  test("still redacts a key inside one string, with escaped newlines", () => {
    const key = `${begin}\n${"k".repeat(64)}\n${end}`;
    const records = [
      JSON.stringify({ type: "tool", output: `cat id: ${key}` }),
      JSON.stringify({ type: "assistant", text: "untouched" }),
    ];
    const result = redactJsonStrings(bytes(`${records.join("\n")}\n`));
    expect(countByKind(result.matches)).toEqual({ "private-key": 1 });
    const [first, second] = text(result.bytes).split("\n");
    expect(first).toContain("REDACTED-private-key");
    expect(first).not.toContain("k".repeat(64));
    expect(() => JSON.parse(first ?? "") as unknown).not.toThrow();
    expect(second).toBe(records[1]);
  });

  test("redacts each string of a pretty-printed JSON file", () => {
    const input = JSON.stringify(
      { a: `token ${linear}`, b: { c: jwt } },
      null,
      2,
    );
    const result = redactJsonStrings(bytes(input));
    expect(countByKind(result.matches)).toEqual({ "linear-key": 1, jwt: 1 });
    expect(result.bytes.length).toBe(bytes(input).length);
    expect(() => JSON.parse(text(result.bytes)) as unknown).not.toThrow();
  });
});
