import { expect, test } from "vitest";
import {
  MODEL,
  branchName,
  freeBranch,
  namingBody,
  namingRequest,
  parseNaming,
} from "../private_dot_config/herdr-app/mods/my-worktree/naming.js";

const reply = (text: string) => ({
  status: "completed",
  output: [
    { type: "reasoning", content: [] },
    { type: "message", content: [{ type: "output_text", text }] },
  ],
});

test("the request asks the model for a strict branch-and-title schema", () => {
  const body = namingBody("fix the flaky cache test");
  expect(body.model).toBe(MODEL);
  expect(body.store).toBe(false);
  expect(body.input).toBe("fix the flaky cache test");
  expect(body.text.format.strict).toBe(true);
  expect(body.text.format.schema.required).toEqual(["branch", "title"]);
});

test("the key is only in the Authorization header", () => {
  const request = namingRequest("hello", "sk-test");
  expect(request.method).toBe("POST");
  expect(request.headers.Authorization).toBe("Bearer sk-test");
  expect(request.body).not.toContain("sk-test");
  expect(JSON.parse(request.body)).toEqual(namingBody("hello"));
});

test("a completed reply gives a coerced branch and a trimmed title", () => {
  expect(
    parseNaming(
      200,
      reply(
        String.raw`{"branch":"Fix Brim cache","title":"  Fix brim   cache test\n"}`,
      ),
    ),
  ).toEqual({ branch: "fix-brim-cache", title: "Fix brim cache test" });
});

test("HTTP errors carry OpenAI's message", () => {
  expect(() =>
    parseNaming(401, { error: { message: "Incorrect API key provided" } }),
  ).toThrow("OpenAI 401: Incorrect API key provided");
  expect(() => parseNaming(500, null)).toThrow("OpenAI 500");
});

test("refusals, incomplete replies and malformed output are errors", () => {
  expect(() =>
    parseNaming(200, {
      status: "completed",
      output: [
        { type: "message", content: [{ type: "refusal", refusal: "no" }] },
      ],
    }),
  ).toThrow("OpenAI refused: no");
  expect(() => parseNaming(200, { status: "incomplete", output: [] })).toThrow(
    "OpenAI response incomplete.",
  );
  expect(() => parseNaming(200, reply("not json"))).toThrow("isn't JSON");
  expect(() => parseNaming(200, reply('{"branch":"..","title":"x"}'))).toThrow(
    "no usable branch name",
  );
  expect(() => parseNaming(200, reply('{"branch":"ok","title":" "}'))).toThrow(
    "no title",
  );
  expect(() => parseNaming(200, { status: "completed", output: [] })).toThrow(
    "no name",
  );
});

test.each([
  ["test s", "test-s"],
  ["  Fix: the ~bug^ [now]? ", "fix-the-bug-now"],
  ["feature//two..dots", "feature/two.dots"],
  ["-leading/.hidden/trailing.lock", "leading/hidden/trailing"],
  ["café déjà vu", "cafe-deja-vu"],
  ["@", ""],
  ["@{upstream}", "upstream"],
  ["", ""],
  [
    "a-very-long-branch-name-that-keeps-going-past-the-limit",
    "a-very-long-branch-name-that-keeps-going",
  ],
])("branchName(%j) is %j", (input, expected) => {
  expect(branchName(input)).toBe(expected);
});

test("freeBranch suffixes until a branch is free", async () => {
  const existing = new Set(["fix-cache", "fix-cache-2"]);
  const taken = (name: string) => Promise.resolve(existing.has(name));
  expect(await freeBranch("fix-cache", taken)).toBe("fix-cache-3");
  expect(await freeBranch("new-work", taken)).toBe("new-work");
  const long = "x".repeat(40);
  const takenLong = (name: string) => Promise.resolve(name === long);
  expect(await freeBranch(long, takenLong)).toBe(`${"x".repeat(38)}-2`);
});
