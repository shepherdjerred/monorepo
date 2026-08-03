import { test, expect, afterEach } from "bun:test";
import { z } from "zod";
import { redactSecrets, redactText } from "#src/redact.ts";

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

afterEach(() => {
  delete Bun.env["OPENAI_API_KEY"];
  delete Bun.env["XAI_API_KEY"];
  delete Bun.env["OPENROUTER_API_KEY"];
});

// Composed from fragments so no single string literal trips the no-secrets rule.
const FAKE_SECRET = ["sk", "proj", "aaa", "bbb", "ccc"].join("-");

test("redactText masks known secret env-var values in any format", () => {
  Bun.env["OPENAI_API_KEY"] = FAKE_SECRET;
  // Mimics `env` / `echo $OPENAI_API_KEY` output reaching a tool body — the raw
  // value appears both in a NAME=value line and bare on a later line.
  const body = `OPENAI_API_KEY=${FAKE_SECRET}\nnext line: ${FAKE_SECRET}`;
  const out = redactText(body);
  expect(out).not.toContain(FAKE_SECRET);
  expect(out).toContain("[REDACTED]");
});

test("redactText masks every documented provider credential", () => {
  const xaiSecret = ["xai", "provider", "credential"].join("-");
  const openRouterSecret = ["openrouter", "provider", "credential"].join("-");
  Bun.env["XAI_API_KEY"] = xaiSecret;
  Bun.env["OPENROUTER_API_KEY"] = openRouterSecret;

  const out = redactText(`xai=${xaiSecret} router=${openRouterSecret}`);
  expect(out).not.toContain(xaiSecret);
  expect(out).not.toContain(openRouterSecret);
  expect(out.match(/\[REDACTED\]/g)).toHaveLength(2);
});

test("redactSecrets applies literal-value masking inside nested strings", () => {
  Bun.env["OPENAI_API_KEY"] = FAKE_SECRET;
  const redacted = HeadersSchema.parse(
    redactSecrets({ headers: { raw: `provider response: ${FAKE_SECRET}` } }),
  );
  expect(redacted.headers.raw).toBe("provider response: [REDACTED]");
});

test("redactSecrets masks an explicitly configured provider credential", () => {
  const customSecret = ["private", "compatible", "endpoint", "key"].join("-");
  const redacted = HeadersSchema.parse(
    redactSecrets({ headers: { raw: `provider response: ${customSecret}` } }, [
      customSecret,
    ]),
  );
  expect(redacted.headers.raw).toBe("provider response: [REDACTED]");
});

test("redactSecrets masks short explicitly configured credentials", () => {
  const customSecret = "abc";
  const redacted = HeadersSchema.parse(
    redactSecrets({ headers: { raw: `provider response: ${customSecret}` } }, [
      customSecret,
    ]),
  );
  expect(redacted.headers.raw).toBe("provider response: [REDACTED]");
});

test("redactSecrets ignores empty explicitly configured credentials", () => {
  const redacted = HeadersSchema.parse(
    redactSecrets({ headers: { raw: "provider response" } }, [""]),
  );
  expect(redacted.headers.raw).toBe("provider response");
});

test("redactText does not mask short env values that could hit unrelated text", () => {
  Bun.env["OPENAI_API_KEY"] = "short";
  expect(redactText("the word short appears here")).toBe(
    "the word short appears here",
  );
});

test("redactText masks secret-shaped NAME=value assignments structurally", () => {
  const out = redactText(
    "CODEX_ACCESS_TOKEN=deadbeefcafe POKEMONCTL_TOKEN: abc123xyz PATH=/usr/bin",
  );
  expect(out).toContain("CODEX_ACCESS_TOKEN=[REDACTED]");
  expect(out).toContain("POKEMONCTL_TOKEN: [REDACTED]");
  // Non-secret assignments are left intact.
  expect(out).toContain("PATH=/usr/bin");
  expect(out).not.toContain("deadbeefcafe");
  expect(out).not.toContain("abc123xyz");
});

test("redactText masks quoted JSON secret fields (e.g. cat auth.json)", () => {
  const accessTok = ["aaa", "bbb", "ccc", "ddd"].join(".");
  const refreshTok = ["eee", "fff", "ggg"].join(".");
  // Mimics `cat auth.json` output — quote between field name and colon dodges
  // the unquoted NAME=value pass, and these tokens aren't env vars.
  const body = `{"access_token":"${accessTok}", "refresh_token" : "${refreshTok}", "expiry": 123}`;
  const out = redactText(body);
  expect(out).not.toContain(accessTok);
  expect(out).not.toContain(refreshTok);
  expect(out).toContain('"access_token":"[REDACTED]"');
  expect(out).toContain('"refresh_token" : "[REDACTED]"');
  // Non-secret fields are untouched.
  expect(out).toContain('"expiry": 123');
});

test("redactText masks Bearer tokens", () => {
  // Token interpolated (not a string literal) so gitleaks doesn't flag it.
  const bearer = ["sk", "live", "xyz123"].join("-");
  expect(redactText(`curl -H 'Authorization: Bearer ${bearer}'`)).toBe(
    "curl -H 'Authorization: Bearer [REDACTED]'",
  );
});
