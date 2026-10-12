import { expect, test } from "vitest";
import { publicOriginFromEnv } from "#src/webserver/origin.ts";

test.each([
  undefined,
  "",
  "not a URL",
  "https://pokebot.sjer.red/",
  "https://pokebot.sjer.red/path",
])("rejects an absent or non-origin bootstrap value: %s", (origin) => {
  expect(() => publicOriginFromEnv({ WEB_PUBLIC_ORIGIN: origin })).toThrow(
    "WEB_PUBLIC_ORIGIN",
  );
});
test("keeps the exact deployment origin, including a development port", () => {
  expect(
    publicOriginFromEnv({ WEB_PUBLIC_ORIGIN: "http://localhost:5173" }),
  ).toBe("http://localhost:5173");
});
