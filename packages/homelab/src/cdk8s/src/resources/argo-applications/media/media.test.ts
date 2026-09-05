import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createMediaApp } from "./media.ts";

const MediaApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.literal("media") }),
  spec: z.object({
    syncPolicy: z.object({
      automated: z.object({ enabled: z.literal(true) }),
      syncOptions: z.array(z.string()),
    }),
  }),
});

describe("media Argo CD application", () => {
  it("uses server-side apply for complete workload reconciliation", () => {
    const app = new App();
    const chart = new Chart(app, "test");
    createMediaApp(chart);
    const manifest = parseAllDocuments(app.synthYaml())
      .map((document) => MediaApplicationSchema.safeParse(document.toJS()))
      .find((result) => result.success);
    if (!manifest?.success) {
      throw new Error("Media Application was not synthesized");
    }

    expect(manifest.data.spec.syncPolicy.syncOptions).toContain(
      "ServerSideApply=true",
    );
  });
});
