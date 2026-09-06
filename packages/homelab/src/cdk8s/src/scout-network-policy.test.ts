import { describe, expect, test } from "vitest";
import { findResource, scoutResources } from "./scout-test-resources.ts";

describe("Scout backend telemetry boundary", () => {
  test.each(["beta", "prod"] as const)(
    "%s Scout backend egress admits Tempo OTLP",
    (stage) => {
      expect(
        findResource(
          scoutResources(stage),
          "NetworkPolicy",
          "scout-egress-netpol",
        ).spec,
      ).toEqual(
        expect.objectContaining({
          podSelector: { matchLabels: { app: "scout-backend" } },
          egress: expect.arrayContaining([
            {
              to: [
                {
                  namespaceSelector: {
                    matchLabels: { "kubernetes.io/metadata.name": "tempo" },
                  },
                },
              ],
              ports: [{ port: 4318, protocol: "TCP" }],
            },
          ]),
        }),
      );
    },
  );
});
