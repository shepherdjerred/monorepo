import { describe, expect, test } from "vitest";
import {
  nsPeer,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import {
  defineEndpoint,
  FLIPT_ENDPOINT,
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
    expect(FLIPT_ENDPOINT.url).toBe(
      "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
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
});
