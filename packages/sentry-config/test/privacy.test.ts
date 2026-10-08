import * as Sentry from "@sentry/bun";
import type { Envelope, Event } from "@sentry/core";
import { afterEach, expect, test } from "vitest";
import {
  sentryBrowserOptions,
  sentryDataCollection,
} from "@shepherdjerred/sentry-config";

afterEach(async () => {
  await Sentry.close();
});

test.each([
  { release: "image-release", expected: "image-release" },
  { release: undefined, expected: undefined },
  { release: 123, expected: undefined },
])(
  "browser options retain application identity and validate release $release",
  ({ release, expected }) => {
    expect(
      sentryBrowserOptions({
        dsn: "https://public@example.com/1",
        environment: "production",
        release,
      }),
    ).toEqual({
      dsn: "https://public@example.com/1",
      environment: "production",
      release: expected,
      dataCollection: sentryDataCollection(),
    });
  },
);

test("the SDK filters automatic request identity while retaining error context", async () => {
  const envelopes: Envelope[] = [];
  const client = Sentry.init({
    dsn: "https://public@example.com/1",
    release: "privacy-test",
    environment: "test",
    dataCollection: sentryDataCollection(),
    enableOpenTelemetrySetup: false,
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [Sentry.requestDataIntegration()],
    transport: () => ({
      send(envelope) {
        envelopes.push(envelope);
        return Promise.resolve({ statusCode: 200 });
      },
      flush() {
        return Promise.resolve(true);
      },
    }),
  });
  expect(client).toBeDefined();
  const event: Event = {
    exception: {
      values: [{ type: "Error", value: "Synthetic privacy check" }],
    },
    user: { id: "explicit-actor" },
    sdkProcessingMetadata: {
      normalizedRequest: {
        method: "GET",
        url: "https://example.com/?forwarded=private&mode=report",
        query_string: "forwarded=private&mode=report",
        headers: {
          forwarded: "private",
          "x-real-ip": "192.0.2.1",
          "remote-user": "private",
          cookie: "session=private",
          "x-request-id": "request-1",
        },
        cookies: { session: "private" },
      },
      ipAddress: "192.0.2.1",
    },
  };
  Sentry.captureEvent(event);
  await Sentry.flush();

  expect(envelopes).toHaveLength(1);
  const sent = envelopes[0]?.[1][0]?.[1];
  expect(sent).toMatchObject({
    release: "privacy-test",
    environment: "test",
    exception: event.exception,
    user: { id: "explicit-actor" },
    request: {
      method: "GET",
      headers: { "x-request-id": "request-1" },
    },
  });
  const serialized = JSON.stringify(sent);
  expect(serialized).not.toContain("private");
  expect(serialized).not.toContain("192.0.2.1");
  expect(serialized).toContain("mode=report");
});

test("the SDK keeps permissive v11 categories disabled", () => {
  const client = Sentry.init({
    dataCollection: sentryDataCollection(),
    enableOpenTelemetrySetup: false,
    defaultIntegrations: false,
  });
  expect(client?.getDataCollectionOptions()).toMatchObject({
    userInfo: false,
    cookies: false,
    httpBodies: [],
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
  });
});
