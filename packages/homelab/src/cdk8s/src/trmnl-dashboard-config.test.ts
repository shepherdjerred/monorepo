import { describe, expect, it } from "bun:test";
import { App } from "cdk8s";
import { setupCharts } from "./setup-charts.ts";

async function synthesizeApp(): Promise<string> {
  const app = new App({ outdir: ".test-synth" });
  await setupCharts(app);
  return app.synthYaml();
}

describe("trmnl-dashboard configuration", () => {
  it("points Bugsink traffic at the internal service", async () => {
    const yaml = await synthesizeApp();

    expect(yaml).toContain("name: BUGSINK_URL");
    expect(yaml).toContain(
      "value: http://bugsink-bugsink-service.bugsink:8000/api/canonical/0",
    );
  });

  it("allows Bugsink internal service hostnames", async () => {
    const yaml = await synthesizeApp();

    expect(yaml).toContain("bugsink-bugsink-service.bugsink");
    expect(yaml).toContain("bugsink-bugsink-service.bugsink.svc.cluster.local");
  });
});
