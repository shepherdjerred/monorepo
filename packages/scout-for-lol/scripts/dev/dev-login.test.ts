import { expect, test } from "vitest";
import { buildDevLoginUrl, parseDevLoginArgs } from "./dev-login.ts";

test("parses the selected user and local return path", () => {
  const result = parseDevLoginArgs([
    "--discord-id",
    "222222222222222222",
    "--username",
    "Test User",
    "--return-to",
    "/app/g/123/reports",
  ]);

  expect(result).toEqual({
    kind: "options",
    options: {
      discordId: "222222222222222222",
      username: "Test User",
      returnTo: "/app/g/123/reports",
      backendOrigin: "http://127.0.0.1:3000",
      webOrigin: "http://localhost:5180",
    },
  });
});

test("uses the fake user and app root by default", () => {
  const result = parseDevLoginArgs([]);

  expect(result).toEqual({
    kind: "options",
    options: {
      discordId: undefined,
      username: undefined,
      returnTo: "/app/",
      backendOrigin: "http://127.0.0.1:3000",
      webOrigin: "http://localhost:5180",
    },
  });
});

test("rejects external return paths", () => {
  expect(() =>
    parseDevLoginArgs(["--return-to", "https://evil.example/"]),
  ).toThrow("--return-to must be a path on the local app");
});

test("builds an encoded dev-login URL", () => {
  const result = buildDevLoginUrl({
    discordId: "222222222222222222",
    username: "Test User",
    returnTo: "/app/g/123?tab=reports",
    backendOrigin: "http://127.0.0.1:3000",
    webOrigin: "http://localhost:5180",
  });

  expect(result).toBe(
    "http://localhost:5180/api/dev/login?discordId=222222222222222222&username=Test+User&returnTo=%2Fapp%2Fg%2F123%3Ftab%3Dreports",
  );
});
