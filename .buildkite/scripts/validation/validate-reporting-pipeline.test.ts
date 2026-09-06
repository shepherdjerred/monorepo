import path from "node:path";
import { describe, expect, test } from "vitest";
import { validateReportingPipeline } from "./validate-reporting-pipeline.ts";

const runnerContract =
  "run --cwd packages/scout-for-lol/packages/design-audit test:e2e:ci";
const memoryRequestContract = 'requests: { cpu: "2", memory: "12Gi" }';
const memoryLimitContract = 'limits: { cpu: "4", memory: "16Gi" }';

async function reportingPipeline(): Promise<string> {
  const pipelineFile = Bun.file(
    path.join(import.meta.dir, "..", "..", "reporting-pipeline.yml"),
  );
  return await pipelineFile.text();
}

describe("Scout reporting audit contract", () => {
  test("accepts the persistent local-stack runner", async () => {
    const pipeline = await reportingPipeline();
    expect(() => validateReportingPipeline(pipeline)).not.toThrow();
  });

  test("rejects a pipeline that bypasses the runner", async () => {
    const reportingPipelineYaml = await reportingPipeline();
    const pipeline = reportingPipelineYaml.replace(
      runnerContract,
      "run --cwd packages/scout-for-lol/packages/design-audit test:e2e",
    );
    expect(() => validateReportingPipeline(pipeline)).toThrow(runnerContract);
  });

  test("rejects the previously undersized browser pod", async () => {
    const reportingPipelineYaml = await reportingPipeline();
    const pipeline = reportingPipelineYaml
      .replace(memoryRequestContract, 'requests: { cpu: "2", memory: "5Gi" }')
      .replace(memoryLimitContract, 'limits: { cpu: "4", memory: "12Gi" }');
    expect(() => validateReportingPipeline(pipeline)).toThrow(
      memoryRequestContract,
    );
  });
});
