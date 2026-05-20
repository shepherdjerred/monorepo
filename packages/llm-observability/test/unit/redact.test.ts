import { test, expect } from "bun:test";
import { redactSecrets } from "../../src/redact.ts";

test("redacts known secret keys regardless of case", () => {
  const input = {
    Authorization: "Bearer xyz",
    "x-api-key": "sk-abcd",
    api_key: "secret-thing",
    apiKey: "sk-2",
    password: "hunter2",
    nested: { TOKEN: "t1", access_key: "ak1", note: "hello" },
  };
  const redacted = redactSecrets(input);
  expect(redacted.Authorization).toBe("[REDACTED]");
  expect(redacted["x-api-key"]).toBe("[REDACTED]");
  expect(redacted.api_key).toBe("[REDACTED]");
  expect(redacted.apiKey).toBe("[REDACTED]");
  expect(redacted.password).toBe("[REDACTED]");
  expect(redacted.nested.TOKEN).toBe("[REDACTED]");
  expect(redacted.nested.access_key).toBe("[REDACTED]");
  expect(redacted.nested.note).toBe("hello");
});

test("replaces Bearer tokens in string values", () => {
  const input = {
    headers: {
      raw: "Authorization: Bearer abc123_definitely-a-token=",
    },
  };
  const redacted = redactSecrets(input);
  expect(redacted.headers.raw).toContain("[REDACTED]");
  expect(redacted.headers.raw).not.toContain("abc123_definitely-a-token");
});

test("does not mutate input", () => {
  const input = { token: "real", inner: { secret: "real-inner" } };
  const before = JSON.stringify(input);
  redactSecrets(input);
  expect(JSON.stringify(input)).toBe(before);
});

test("preserves non-secret strings, numbers, booleans, and arrays", () => {
  const input = {
    name: "scout-backend",
    count: 42,
    enabled: true,
    list: ["a", "b", "Bearer leaked"],
  };
  const redacted = redactSecrets(input);
  expect(redacted.name).toBe("scout-backend");
  expect(redacted.count).toBe(42);
  expect(redacted.enabled).toBe(true);
  expect(redacted.list[0]).toBe("a");
  expect(redacted.list[1]).toBe("b");
  expect(redacted.list[2]).toContain("[REDACTED]");
});

test("does not redact Discord-style snowflake IDs or usernames", () => {
  const input = {
    discord: {
      user_id: "123456789012345678",
      username: "jerred",
      channel_id: "987654321098765432",
    },
  };
  const redacted = redactSecrets(input);
  expect(redacted.discord.user_id).toBe("123456789012345678");
  expect(redacted.discord.username).toBe("jerred");
});
