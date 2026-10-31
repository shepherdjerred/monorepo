import { expect, test } from "vitest";
import { bugsinkDataCollection } from "@shepherdjerred/bugsink-config";
import {
  assertNoSentryEnvironment,
  bugsinkServerOptions,
} from "@shepherdjerred/bugsink-config/server";

test("server options pass every SDK-resolved setting explicitly", () => {
  const options = bugsinkServerOptions({
    dsn: "https://public@example.com/1",
    environment: "production",
    release: "2.0.0-1",
    env: { BUGSINK_DSN: "https://public@example.com/1" },
  });
  expect(options).toEqual({
    dsn: "https://public@example.com/1",
    environment: "production",
    release: "2.0.0-1",
    debug: false,
    dataCollection: bugsinkDataCollection(),
  });
  expect(options).not.toHaveProperty("tracesSampleRate");
});

test.each(["SENTRY_DSN", "SENTRY_TRACE", "SENTRY_FOO"])(
  "server options reject %s in the environment",
  (key) => {
    expect(() =>
      bugsinkServerOptions({
        dsn: "https://public@example.com/1",
        environment: "production",
        release: undefined,
        env: { [key]: "set" },
      }),
    ).toThrow(`Unsupported Sentry SDK environment variables: ${key}.`);
  },
);

test("the environment guard lists every Sentry variable and ignores Bugsink ones", () => {
  expect(() =>
    assertNoSentryEnvironment({
      SENTRY_RELEASE: "x",
      BUGSINK_DSN: "y",
      SENTRY_DEBUG: "",
    }),
  ).toThrow(
    "Unsupported Sentry SDK environment variables: SENTRY_DEBUG, SENTRY_RELEASE.",
  );
  expect(() =>
    assertNoSentryEnvironment({ BUGSINK_DSN: "y", BUGSINK_RELEASE: "z" }),
  ).not.toThrow();
});
