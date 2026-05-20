import { test, expect } from "bun:test";
import { z } from "zod";
import { redactSecrets } from "#src/redact.ts";

const FlatSecretsSchema = z.object({
  Authorization: z.string(),
  "x-api-key": z.string(),
  api_key: z.string(),
  apiKey: z.string(),
  password: z.string(),
  nested: z.object({
    TOKEN: z.string(),
    access_key: z.string(),
    note: z.string(),
  }),
});

test("redacts known secret keys regardless of case", () => {
  const input = {
    Authorization: "Bearer xyz",
    "x-api-key": "sk-abcd",
    api_key: "secret-thing",
    apiKey: "sk-2",
    password: "hunter2",
    nested: { TOKEN: "t1", access_key: "ak1", note: "hello" },
  };
  const redacted = FlatSecretsSchema.parse(redactSecrets(input));
  expect(redacted.Authorization).toBe("[REDACTED]");
  expect(redacted["x-api-key"]).toBe("[REDACTED]");
  expect(redacted.api_key).toBe("[REDACTED]");
  expect(redacted.apiKey).toBe("[REDACTED]");
  expect(redacted.password).toBe("[REDACTED]");
  expect(redacted.nested.TOKEN).toBe("[REDACTED]");
  expect(redacted.nested.access_key).toBe("[REDACTED]");
  expect(redacted.nested.note).toBe("hello");
});

const HeadersSchema = z.object({
  headers: z.object({ raw: z.string() }),
});

test("replaces Bearer tokens in string values", () => {
  const input = {
    headers: {
      raw: "Authorization: Bearer abc123_definitely-a-token=",
    },
  };
  const redacted = HeadersSchema.parse(redactSecrets(input));
  expect(redacted.headers.raw).toContain("[REDACTED]");
  expect(redacted.headers.raw).not.toContain("abc123_definitely-a-token");
});

test("does not mutate input", () => {
  const input = { token: "real", inner: { secret: "real-inner" } };
  const before = JSON.stringify(input);
  redactSecrets(input);
  expect(JSON.stringify(input)).toBe(before);
});

const ScalarsSchema = z.object({
  name: z.string(),
  count: z.number(),
  enabled: z.boolean(),
  list: z.array(z.string()),
});

test("preserves non-secret strings, numbers, booleans, and arrays", () => {
  const input = {
    name: "scout-backend",
    count: 42,
    enabled: true,
    list: ["a", "b", "Bearer leaked"],
  };
  const redacted = ScalarsSchema.parse(redactSecrets(input));
  expect(redacted.name).toBe("scout-backend");
  expect(redacted.count).toBe(42);
  expect(redacted.enabled).toBe(true);
  expect(redacted.list[0]).toBe("a");
  expect(redacted.list[1]).toBe("b");
  expect(redacted.list[2]).toContain("[REDACTED]");
});

const DiscordSchema = z.object({
  discord: z.object({
    user_id: z.string(),
    username: z.string(),
    channel_id: z.string(),
  }),
});

test("does not redact Discord-style snowflake IDs or usernames", () => {
  const input = {
    discord: {
      user_id: "123456789012345678",
      username: "jerred",
      channel_id: "987654321098765432",
    },
  };
  const redacted = DiscordSchema.parse(redactSecrets(input));
  expect(redacted.discord.user_id).toBe("123456789012345678");
  expect(redacted.discord.username).toBe("jerred");
});
