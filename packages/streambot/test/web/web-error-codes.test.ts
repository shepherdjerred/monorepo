import path from "node:path";
import { expect, test } from "vitest";
import { WebError } from "@shepherdjerred/streambot/web/server/errors.ts";
import {
  WEB_API_ERROR_CODES,
  WebApiErrorCodeSchema,
} from "@shepherdjerred/streambot/web/shared/error-codes.ts";
import { ErrorSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";

const SRC = path.resolve(import.meta.dirname, "../../src");
const listed: ReadonlySet<string> = new Set(WEB_API_ERROR_CODES);

async function sources(): Promise<{ file: string; text: string }[]> {
  const files = await Array.fromAsync(
    new Bun.Glob("**/*.ts").scan({ cwd: SRC }),
  );
  return await Promise.all(
    files
      .filter((file) => !file.endsWith(".test.ts"))
      .map(async (file) => ({
        file,
        text: await Bun.file(path.join(SRC, file)).text(),
      })),
  );
}

/** The literal code of every `new <name>(status, "code", …)` in the source, by file. */
function thrownCodes(
  text: string,
  name: "WebError" | "MusicError",
): { literal: string[]; constructions: number } {
  const constructions = text.split(`new ${name}(`).length - 1;
  const literal = [
    ...text.matchAll(
      new RegExp(String.raw`new ${name}\(\s*[^,]+,\s*"([a-z0-9_]+)"`, "gu"),
    ),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
  return { literal, constructions };
}

/** `true` only while `WebError`'s code parameter refuses an arbitrary string. */
type CodeIsClosed = string extends ConstructorParameters<typeof WebError>[1]
  ? false
  : true;

test("WebError only accepts a listed code", () => {
  // Fails to typecheck if the parameter is widened back to `string`.
  const closed: CodeIsClosed = true;
  expect(closed).toBe(true);
  expect(new WebError(409, "playback_changed", "x").code).toBe(
    "playback_changed",
  );
});

test("every WebError and MusicError the server throws uses a listed literal code", async () => {
  const unlisted: string[] = [];
  for (const { file, text } of await sources())
    for (const name of ["WebError", "MusicError"] as const) {
      const { literal, constructions } = thrownCodes(text, name);
      // A computed code could escape the list, so every construction names its code literally.
      expect(literal.length, `${file}: ${name} with a computed code`).toBe(
        constructions,
      );
      for (const code of literal)
        if (!listed.has(code)) unlisted.push(`${file}: ${code}`);
    }
  expect(unlisted).toEqual([]);
});

test("every listed code is one the source can still produce", async () => {
  const files = await sources();
  const all = files
    .filter(
      (entry) => entry.file !== path.join("web", "shared", "error-codes.ts"),
    )
    .map((entry) => entry.text)
    .join("\n");
  const unused = WEB_API_ERROR_CODES.filter(
    (code) => !all.includes(`"${code}"`),
  );
  expect(unused).toEqual([]);
});

test("the wire stays a plain string so an older client parses a newer code", () => {
  expect(WebApiErrorCodeSchema.safeParse("a_future_code").success).toBe(false);
  expect(
    ErrorSchema.safeParse({ code: "a_future_code", message: "x" }).success,
  ).toBe(true);
});
