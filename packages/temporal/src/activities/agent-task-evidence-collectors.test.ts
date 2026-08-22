import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentTaskInputV2Schema } from "#shared/agent-task.ts";
import {
  collectDeclaredAgentTaskEvidence,
  mergeAgentTaskEvidence,
} from "./agent-task-evidence-collectors.ts";

const temporaryDirectories: string[] = [];

function successfulPrometheusFetch(request: string | URL | Request) {
  const requestUrl =
    typeof request === "string"
      ? request
      : request instanceof URL
        ? request.toString()
        : request.url;
  expect(requestUrl).toContain("%7Bjob%3D%22temporal-worker%22%7D");
  return Promise.resolve(
    Response.json({
      status: "success",
      data: {
        resultType: "vector",
        result: [{ metric: {}, value: [0, "1"] }],
      },
    }),
  );
}

function failedPrometheusFetch() {
  return Promise.resolve(
    Response.json({ status: "error", error: "bad query" }),
  );
}

function rangePrometheusFetch(request: string | URL | Request) {
  const url = new URL(
    typeof request === "string"
      ? request
      : request instanceof URL
        ? request.toString()
        : request.url,
  );
  expect(url.pathname).toBe("/api/v1/query_range");
  expect(url.searchParams.get("start")).not.toBeNull();
  expect(url.searchParams.get("end")).not.toBeNull();
  expect(url.searchParams.get("step")).toBe("300");
  return Promise.resolve(
    Response.json({
      status: "success",
      data: {
        resultType: "matrix",
        result: [{ metric: {}, values: [[0, "1"]] }],
      },
    }),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function commandInput(
  argv: string[],
  output: "allow-empty" | "non-empty" | "json",
  successExitCodes?: number[],
  passedExitCodes: number[] = [0],
) {
  return AgentTaskInputV2Schema.parse({
    contractVersion: 2,
    title: "Collect service evidence",
    prompt: "Interpret the independently collected evidence.",
    checks: [
      {
        id: "service-health",
        label: "Service health",
        required: true,
        evidenceRequirement: "Current service output.",
        evidenceCollectors: [
          {
            id: "service-command",
            kind: "command",
            argv,
            output,
            ...(successExitCodes === undefined ? {} : { successExitCodes }),
            expectation: { kind: "exit-code", passedExitCodes },
          },
        ],
      },
    ],
    provider: "codex",
    mode: "report-only",
    repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
  });
}

describe("declared command evidence", () => {
  test("executes exact argv without shell interpretation", async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), "collector-test-"));
    temporaryDirectories.push(workdir);
    const shellSentinel = path.join(workdir, "must-not-exist");
    const literalArgument = `$(touch ${shellSentinel})`;

    const receipts = await collectDeclaredAgentTaskEvidence(
      commandInput(["/usr/bin/printf", "%s", literalArgument], "non-empty"),
      workdir,
      { fetch, environment: { PATH: "/usr/bin:/bin" } },
    );

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      id: "collector:service-health:service-command",
      origin: "declared-collector",
      status: "success",
      excerpt: literalArgument,
    });
    expect(await Bun.file(shellSentinel).exists()).toBe(false);
  });

  test("fails typed JSON validation for prose output", async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), "collector-test-"));
    temporaryDirectories.push(workdir);

    const receipts = await collectDeclaredAgentTaskEvidence(
      commandInput(["/usr/bin/printf", "not-json"], "json"),
      workdir,
      { fetch, environment: { PATH: "/usr/bin:/bin" } },
    );

    expect(receipts[0]?.status).toBe("failure");
    expect(receipts[0]?.excerpt).toContain(
      "Collector stdout was not a JSON object or array",
    );
  });

  test("validates raw JSON before redacting retained evidence", async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), "collector-test-"));
    temporaryDirectories.push(workdir);

    const receipts = await collectDeclaredAgentTaskEvidence(
      commandInput(["/usr/bin/printf", '{"value":12345678}'], "json"),
      workdir,
      {
        fetch,
        environment: {
          PATH: "/usr/bin:/bin",
          TEST_SECRET_VALUE: "12345678",
        },
      },
    );

    expect(receipts[0]?.status).toBe("success");
    expect(receipts[0]?.excerpt).toBe('{"value":***}');
  });

  test("accepts explicitly declared semantic no-match exit codes", async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), "collector-test-"));
    temporaryDirectories.push(workdir);

    const receipts = await collectDeclaredAgentTaskEvidence(
      commandInput(["/usr/bin/false"], "allow-empty", [1], [1]),
      workdir,
      { fetch, environment: { PATH: "/usr/bin:/bin" } },
    );

    expect(receipts[0]).toMatchObject({
      status: "success",
      semanticStatus: "passed",
      exitCode: 1,
    });
  });

  test("marks structurally valid adverse JSON as a failed predicate", async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), "collector-test-"));
    temporaryDirectories.push(workdir);
    const input = AgentTaskInputV2Schema.parse({
      contractVersion: 2,
      title: "Collect workload health",
      prompt: "Interpret the independently collected workload evidence.",
      checks: [
        {
          id: "workload-health",
          label: "Workload health",
          required: true,
          evidenceRequirement: "Every workload must be running.",
          evidenceCollectors: [
            {
              id: "workloads",
              kind: "command",
              argv: [
                "/usr/bin/printf",
                '{"items":[{"status":{"phase":"Failed"}}]}',
              ],
              output: "json",
              expectation: {
                kind: "json",
                assertions: [
                  {
                    path: ["items", "*", "status", "phase"],
                    operator: "eq",
                    expected: "Running",
                    quantifier: "all",
                  },
                ],
              },
            },
          ],
        },
      ],
      provider: "codex",
      mode: "report-only",
      repo: { fullName: "shepherdjerred/monorepo" },
    });

    const receipts = await collectDeclaredAgentTaskEvidence(input, workdir, {
      fetch,
      environment: { PATH: "/usr/bin:/bin" },
    });

    expect(receipts[0]).toMatchObject({
      status: "success",
      semanticStatus: "failed",
    });
  });
});

describe("declared Prometheus evidence", () => {
  test("requires the successful Prometheus query response schema", async () => {
    const input = AgentTaskInputV2Schema.parse({
      contractVersion: 2,
      title: "Collect metrics",
      prompt: "Interpret the current metric.",
      checks: [
        {
          id: "metrics",
          label: "Metrics",
          required: true,
          evidenceRequirement: "A successful Prometheus query.",
          evidenceCollectors: [
            {
              id: "worker-up",
              kind: "prometheus",
              query: 'up{job="temporal-worker"}',
              expectation: {
                kind: "numeric",
                operator: "eq",
                threshold: 1,
                quantifier: "all",
              },
            },
          ],
        },
      ],
      provider: "claude",
      mode: "report-only",
      repo: { fullName: "shepherdjerred/monorepo" },
    });
    const success = await collectDeclaredAgentTaskEvidence(input, "/tmp", {
      fetch: successfulPrometheusFetch,
      environment: { PROMETHEUS_URL: "https://prometheus.example.test" },
    });
    const failure = await collectDeclaredAgentTaskEvidence(input, "/tmp", {
      fetch: failedPrometheusFetch,
      environment: { PROMETHEUS_URL: "https://prometheus.example.test" },
    });

    expect(success[0]).toMatchObject({
      id: "collector:metrics:worker-up",
      origin: "declared-collector",
      status: "success",
      semanticStatus: "passed",
    });
    expect(failure[0]?.status).toBe("failure");
    expect(failure[0]?.excerpt).toContain(
      "Prometheus response did not satisfy the successful query schema",
    );
  });

  test("captures bounded range query provenance", async () => {
    const input = AgentTaskInputV2Schema.parse({
      contractVersion: 2,
      title: "Collect metric window",
      prompt: "Interpret the metric window.",
      checks: [
        {
          id: "metrics",
          label: "Metrics",
          required: true,
          evidenceRequirement: "A complete 24-hour Prometheus query.",
          evidenceCollectors: [
            {
              id: "worker-up-window",
              kind: "prometheus",
              query: "up",
              windowSeconds: 86_400,
              stepSeconds: 300,
              expectation: {
                kind: "numeric",
                operator: "eq",
                threshold: 1,
                quantifier: "all",
              },
            },
          ],
        },
      ],
      provider: "claude",
      mode: "report-only",
      repo: { fullName: "shepherdjerred/monorepo" },
    });

    const receipts = await collectDeclaredAgentTaskEvidence(input, "/tmp", {
      fetch: rangePrometheusFetch,
      environment: { PROMETHEUS_URL: "https://prometheus.example.test" },
    });

    expect(receipts[0]?.status).toBe("success");
    expect(receipts[0]?.url).toContain("/api/v1/query_range?");
  });

  test("marks an adverse numeric observation without failing collection", async () => {
    const input = AgentTaskInputV2Schema.parse({
      contractVersion: 2,
      title: "Collect service availability",
      prompt: "Interpret the independently collected metric.",
      checks: [
        {
          id: "availability",
          label: "Availability",
          required: true,
          evidenceRequirement: "Every target must be up.",
          evidenceCollectors: [
            {
              id: "service-up",
              kind: "prometheus",
              query: 'up{namespace="service"}',
              expectation: {
                kind: "numeric",
                operator: "eq",
                threshold: 1,
                quantifier: "all",
              },
            },
          ],
        },
      ],
      provider: "codex",
      mode: "report-only",
      repo: { fullName: "shepherdjerred/monorepo" },
    });
    const receipts = await collectDeclaredAgentTaskEvidence(input, "/tmp", {
      fetch: () =>
        Promise.resolve(
          Response.json({
            status: "success",
            data: {
              resultType: "vector",
              result: [{ metric: {}, value: [0, "0"] }],
            },
          }),
        ),
      environment: { PROMETHEUS_URL: "https://prometheus.example.test" },
    });

    expect(receipts[0]).toMatchObject({
      status: "success",
      semanticStatus: "failed",
    });
  });

  test("validates raw responses before redacting retained evidence", async () => {
    const input = AgentTaskInputV2Schema.parse({
      contractVersion: 2,
      title: "Collect secret-bearing metrics",
      prompt: "Interpret the independently collected metric.",
      checks: [
        {
          id: "metrics",
          label: "Metrics",
          required: true,
          evidenceRequirement: "A successful Prometheus query.",
          evidenceCollectors: [
            {
              id: "secret-bearing-result",
              kind: "prometheus",
              query: "service_state",
              expectation: {
                kind: "numeric",
                operator: "gte",
                threshold: 0,
                quantifier: "all",
              },
            },
          ],
        },
      ],
      provider: "claude",
      mode: "report-only",
      repo: { fullName: "shepherdjerred/monorepo" },
    });
    const secret = "12345678";
    const receipts = await collectDeclaredAgentTaskEvidence(input, "/tmp", {
      fetch: () =>
        Promise.resolve(
          Response.json({
            status: "success",
            data: {
              resultType: "vector",
              result: [{ metric: { credential: secret }, value: [0, secret] }],
            },
          }),
        ),
      environment: {
        PROMETHEUS_URL: "https://prometheus.example.test",
        TEST_SECRET_VALUE: secret,
      },
    });

    expect(receipts[0]?.status).toBe("success");
    expect(receipts[0]?.excerpt).toContain("***");
    expect(receipts[0]?.excerpt).not.toContain(secret);
  });
});

describe("Prometheus collector configuration", () => {
  test("reports a malformed PROMETHEUS_URL as a failure receipt", async () => {
    const input = AgentTaskInputV2Schema.parse({
      contractVersion: 2,
      title: "Collect metrics",
      prompt: "Interpret the metrics.",
      checks: [
        {
          id: "metrics",
          label: "Metrics",
          required: true,
          evidenceRequirement: "A successful Prometheus query.",
          evidenceCollectors: [
            {
              id: "worker-up",
              kind: "prometheus",
              query: "up",
              expectation: {
                kind: "numeric",
                operator: "eq",
                threshold: 1,
                quantifier: "all",
              },
            },
          ],
        },
      ],
      provider: "claude",
      mode: "report-only",
      repo: { fullName: "shepherdjerred/monorepo" },
    });

    const receipts = await collectDeclaredAgentTaskEvidence(input, "/tmp", {
      fetch: (): never => {
        throw new Error("fetch must not run for an unparseable base URL");
      },
      environment: { PROMETHEUS_URL: "prometheus.example.test:9090" },
    });

    expect(receipts[0]).toMatchObject({
      id: "collector:metrics:worker-up",
      origin: "declared-collector",
      status: "failure",
    });
    expect(receipts[0]?.excerpt).toContain(
      "PROMETHEUS_URL is not a parseable absolute URL",
    );
  });
});

describe("declared receipt precedence", () => {
  test("replaces a provider-spoofed collector id with the independent receipt", () => {
    const id = "collector:service-health:service-command";
    const merged = mergeAgentTaskEvidence(
      [
        {
          id,
          source: "Bash",
          origin: "provider",
          observedAt: "2026-08-10T12:00:00.000Z",
          status: "success",
          excerpt: "fake",
        },
      ],
      [
        {
          id,
          source: "declared-command:service-command",
          origin: "declared-collector",
          observedAt: "2026-08-10T12:00:01.000Z",
          status: "failure",
          excerpt: "real collector failed",
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      origin: "declared-collector",
      status: "failure",
      excerpt: "real collector failed",
    });
  });
});
