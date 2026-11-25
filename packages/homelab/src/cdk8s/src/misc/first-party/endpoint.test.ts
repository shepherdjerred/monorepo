import { describe, expect, test } from "vitest";
import {
  nsPeer,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import {
  defineEndpoint,
  ERRORS_ADMIN_ENDPOINT,
  ERRORS_INGEST_ENDPOINT,
  PINCHTAB_ENDPOINT,
  TRACKER_ENDPOINT,
} from "./endpoint.ts";

describe("defineEndpoint", () => {
  test("names the Service by app in its namespace", () => {
    expect(TRACKER_ENDPOINT.host).toBe("tracker.tracker.svc.cluster.local");
    expect(TRACKER_ENDPOINT.url).toBe(
      "http://tracker.tracker.svc.cluster.local:7351",
    );
  });

  test("an explicit service overrides the app name in the URL", () => {
    const endpoint = defineEndpoint({
      namespace: "example",
      app: "example",
      service: "example-http",
      port: 8080,
      portName: "http",
    });
    expect(endpoint.url).toBe(
      "http://example-http.example.svc.cluster.local:8080",
    );
  });

  test("peers and ports render exactly as the shared network-policy helpers", () => {
    expect(TRACKER_ENDPOINT.tcp()).toStrictEqual(tcp(7351));
    expect(TRACKER_ENDPOINT.namespacePeer()).toStrictEqual(nsPeer("tracker"));
    expect(TRACKER_ENDPOINT.peer()).toStrictEqual({
      ...nsPeer("tracker"),
      podSelector: { matchLabels: { app: "tracker" } },
    });
  });

  test("each call returns a fresh object", () => {
    const endpoint = defineEndpoint({
      namespace: "example",
      app: "example",
      port: 80,
      portName: "http",
    });
    expect(endpoint.peer()).not.toBe(endpoint.peer());
    expect(endpoint.tcp()).not.toBe(endpoint.tcp());
  });

  test("refuses a pod peer for pods without an app label", () => {
    expect(() => PINCHTAB_ENDPOINT.peer()).toThrow(/no app label/u);
    expect(PINCHTAB_ENDPOINT.namespacePeer()).toStrictEqual(nsPeer("pinchtab"));
  });

  test("declares errors admin and ingest endpoints on distinct services and ports", () => {
    expect(ERRORS_ADMIN_ENDPOINT.url).toBe(
      "http://errors.errors.svc.cluster.local:7370",
    );
    expect(ERRORS_ADMIN_ENDPOINT.portName).toBe("http");
    expect(ERRORS_ADMIN_ENDPOINT.tcp()).toStrictEqual(tcp(7370));
    expect(ERRORS_INGEST_ENDPOINT.url).toBe(
      "http://errors-ingest.errors.svc.cluster.local:7371",
    );
    expect(ERRORS_INGEST_ENDPOINT.portName).toBe("ingest");
    expect(ERRORS_INGEST_ENDPOINT.tcp()).toStrictEqual(tcp(7371));
    expect(ERRORS_INGEST_ENDPOINT.peer()).toStrictEqual({
      ...nsPeer("errors"),
      podSelector: { matchLabels: { app: "errors" } },
    });
  });
});
