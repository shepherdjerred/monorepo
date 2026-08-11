import { describe, expect, test } from "bun:test";
import {
  type AgentTaskInput,
  type AgentTaskResultPayloadV2,
} from "./agent-task.ts";
import { agentTaskCollectorReceiptId } from "./agent-task-evidence-contract.ts";
import {
  extractAgentTaskEvidenceReceipts,
  normalizeAgentTaskV2Result,
} from "./agent-task-evidence.ts";

const OBSERVED_AT = "2026-08-10T17:00:00.000Z";
const COLLECTOR_RECEIPT_ID = agentTaskCollectorReceiptId(
  "service-health",
  "service-health-endpoint",
);

function v2Input(): AgentTaskInput {
  return {
    contractVersion: 2,
    title: "Check service",
    prompt: "Check the service.",
    checks: [
      {
        id: "service-health",
        label: "Service health",
        required: true,
        evidenceRequirement: "A successful health endpoint response.",
        evidenceCollectors: [
          {
            id: "service-health-endpoint",
            kind: "command",
            argv: ["curl", "-fsS", "https://example.com/health"],
            output: "non-empty",
            expectation: { kind: "exit-code", passedExitCodes: [0] },
          },
        ],
      },
    ],
    provider: "claude",
    mode: "report-only",
    repo: { fullName: "shepherdjerred/monorepo" },
    allowSelfCancel: false,
  };
}

function v2Payload(evidenceReceiptIds: string[]): AgentTaskResultPayloadV2 {
  return {
    headline: "The service is healthy.",
    checks: [
      {
        id: "service-health",
        status: "passed",
        summary: "The endpoint returned successfully.",
        evidenceReceiptIds,
      },
    ],
    findings: [],
    limitations: [],
    actions: [],
  };
}

describe("agent task evidence receipts", () => {
  test("extracts Claude tool results by tool-use id", () => {
    const stdout = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "curl -fsS https://example.com/health" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "ok",
              is_error: false,
            },
          ],
        },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    const receipts = extractAgentTaskEvidenceReceipts(
      stdout,
      "claude",
      OBSERVED_AT,
      (value) => value,
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      id: "tool-1",
      source: "Bash",
      origin: "provider",
      status: "success",
      command: "curl -fsS https://example.com/health",
      excerpt: "ok",
    });
  });

  test("redacts commands, URLs, and output before retaining receipts", () => {
    const secret = "secret-token-value";
    const stdout = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-secret",
              name: "WebFetch",
              input: {
                url: `https://example.com/data?token=${secret}`,
                command: `curl -H 'Authorization: Bearer ${secret}'`,
              },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-secret",
              content: `response ${secret}`,
              is_error: false,
            },
          ],
        },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    const receipts = extractAgentTaskEvidenceReceipts(
      stdout,
      "claude",
      OBSERVED_AT,
      (value) => value.replaceAll(secret, "***"),
    );
    expect(JSON.stringify(receipts)).not.toContain(secret);
    expect(receipts[0]?.url).toBe("https://example.com/data?token=***");
  });

  test("extracts Codex command completion receipts", () => {
    const stdout = JSON.stringify({
      type: "item.completed",
      item: {
        id: "item-1",
        type: "command_execution",
        command: "kubectl get pods",
        aggregated_output: "pod Running",
        exit_code: 0,
        status: "completed",
      },
    });
    const receipts = extractAgentTaskEvidenceReceipts(
      stdout,
      "codex",
      OBSERVED_AT,
      (value) => value,
    );
    expect(receipts[0]).toMatchObject({
      id: "item-1",
      origin: "provider",
      status: "success",
      exitCode: 0,
    });
  });
});

describe("agent task evidence normalization", () => {
  test("downgrades unsupported clean claims to partial and inconclusive", () => {
    const normalized = normalizeAgentTaskV2Result(v2Input(), v2Payload([]), []);
    expect(normalized.execution).toBe("partial");
    expect(normalized.verdict).toBe("inconclusive");
    expect(normalized.checks[0]?.status).toBe("failed");
    expect(normalized.limitations).toContain(
      "Check service-health does not have complete successful independently collected evidence.",
    );
  });

  test("permits clean only with successful captured evidence", () => {
    const normalized = normalizeAgentTaskV2Result(
      v2Input(),
      v2Payload([COLLECTOR_RECEIPT_ID]),
      [
        {
          id: COLLECTOR_RECEIPT_ID,
          source: "declared-command:service-health-endpoint",
          origin: "declared-collector",
          observedAt: OBSERVED_AT,
          status: "success",
          semanticStatus: "passed",
          command: '["curl","-fsS","https://example.com/health"]',
        },
      ],
    );
    expect(normalized.execution).toBe("complete");
    expect(normalized.verdict).toBe("clear");
  });

  test("rejects provider-authored command text that imitates a declared collector", () => {
    const normalized = normalizeAgentTaskV2Result(
      v2Input(),
      v2Payload(["tool-1"]),
      [
        {
          id: "tool-1",
          source: "Bash",
          origin: "provider",
          observedAt: OBSERVED_AT,
          status: "success",
          command: 'printf \'["curl","-fsS","https://example.com/health"]\'',
          excerpt: "https://example.com/health",
        },
      ],
    );
    expect(normalized.execution).toBe("partial");
    expect(normalized.verdict).toBe("inconclusive");
    expect(normalized.checks[0]?.status).toBe("failed");
    expect(normalized.limitations.join(" ")).toContain(
      "missing independently collected receipts",
    );
  });

  test("does not let a provider receipt spoof a deterministic collector id", () => {
    const normalized = normalizeAgentTaskV2Result(
      v2Input(),
      v2Payload([COLLECTOR_RECEIPT_ID]),
      [
        {
          id: COLLECTOR_RECEIPT_ID,
          source: "Bash",
          origin: "provider",
          observedAt: OBSERVED_AT,
          status: "success",
          command: "printf fake",
          excerpt: "fake",
        },
      ],
    );
    expect(normalized.execution).toBe("partial");
    expect(normalized.checks[0]?.status).toBe("failed");
    expect(normalized.limitations.join(" ")).toContain(
      "missing independently collected receipts",
    );
  });

  test("keeps replayed v2 checks without collectors partial", () => {
    const input = v2Input();
    const check = input.checks?.[0];
    if (check === undefined) throw new Error("missing test check");
    delete check.evidenceCollectors;
    const normalized = normalizeAgentTaskV2Result(
      input,
      v2Payload(["tool-1"]),
      [
        {
          id: "tool-1",
          source: "Bash",
          observedAt: OBSERVED_AT,
          status: "success",
          command: "curl -fsS https://example.com/health",
        },
      ],
    );
    expect(normalized.execution).toBe("partial");
    expect(normalized.limitations.join(" ")).toContain("legacy v2 coverage");
  });

  test("rejects mixed known and unknown receipt references", () => {
    const normalized = normalizeAgentTaskV2Result(
      v2Input(),
      v2Payload(["tool-1", "tool-unknown"]),
      [
        {
          id: "tool-1",
          source: "Bash",
          observedAt: OBSERVED_AT,
          status: "success",
        },
      ],
    );
    expect(normalized.execution).toBe("partial");
    expect(normalized.verdict).toBe("inconclusive");
    expect(normalized.checks[0]?.status).toBe("failed");
  });

  test("marks unsupported findings as partial", () => {
    const payload = v2Payload([COLLECTOR_RECEIPT_ID]);
    payload.findings = [
      {
        severity: "warning",
        summary: "Unsupported claim",
        evidenceReceiptIds: [],
      },
    ];
    const normalized = normalizeAgentTaskV2Result(v2Input(), payload, [
      {
        id: COLLECTOR_RECEIPT_ID,
        source: "declared-command:service-health-endpoint",
        origin: "declared-collector",
        observedAt: OBSERVED_AT,
        status: "success",
        semanticStatus: "passed",
        command: '["curl","-fsS","https://example.com/health"]',
      },
    ]);
    expect(normalized.execution).toBe("partial");
    expect(normalized.limitations).toContain(
      'Finding "Unsupported claim" lacks complete successful captured evidence.',
    );
    expect(normalized.findings).toEqual([]);
  });
});

describe("agent task semantic predicate normalization", () => {
  test("keeps a fully observed domain failure complete and attention-worthy", () => {
    const payload = v2Payload([COLLECTOR_RECEIPT_ID]);
    const check = payload.checks[0];
    if (check === undefined) throw new Error("missing payload check");
    check.status = "failed";
    check.summary = "The endpoint reported unhealthy.";
    const normalized = normalizeAgentTaskV2Result(v2Input(), payload, [
      {
        id: COLLECTOR_RECEIPT_ID,
        source: "declared-command:service-health-endpoint",
        origin: "declared-collector",
        observedAt: OBSERVED_AT,
        status: "success",
        semanticStatus: "failed",
        excerpt: '{"healthy":false}',
      },
    ]);

    expect(normalized.execution).toBe("complete");
    expect(normalized.verdict).toBe("attention");
    expect(normalized.checks[0]?.status).toBe("failed");
  });

  test("overrides a passed claim when a source-defined predicate failed", () => {
    const normalized = normalizeAgentTaskV2Result(
      v2Input(),
      v2Payload([COLLECTOR_RECEIPT_ID]),
      [
        {
          id: COLLECTOR_RECEIPT_ID,
          source: "prometheus:service-health-endpoint",
          origin: "declared-collector",
          observedAt: OBSERVED_AT,
          status: "success",
          semanticStatus: "failed",
          excerpt: '{"status":"success","data":{"result":[0]}}',
        },
      ],
    );

    expect(normalized.execution).toBe("complete");
    expect(normalized.verdict).toBe("attention");
    expect(normalized.checks[0]?.status).toBe("failed");
    expect(normalized.checks[0]?.summary).toContain(
      "Source-defined collector predicates failed",
    );
  });

  test("does not let a skipped claim hide an adverse predicate", () => {
    const payload = v2Payload([COLLECTOR_RECEIPT_ID]);
    const check = payload.checks[0];
    if (check === undefined) throw new Error("missing payload check");
    check.status = "skipped";
    check.summary = "The agent skipped interpretation.";

    const normalized = normalizeAgentTaskV2Result(v2Input(), payload, [
      {
        id: COLLECTOR_RECEIPT_ID,
        source: "prometheus:service-health-endpoint",
        origin: "declared-collector",
        observedAt: OBSERVED_AT,
        status: "success",
        semanticStatus: "failed",
        excerpt: '{"status":"success","data":{"result":[0]}}',
      },
    ]);

    expect(normalized.execution).toBe("complete");
    expect(normalized.verdict).toBe("attention");
    expect(normalized.checks[0]?.status).toBe("failed");
    expect(normalized.checks[0]?.summary).toContain(
      "Source-defined collector predicates failed",
    );
  });

  test("does not let an omitted claim hide an adverse predicate", () => {
    const baseInput = v2Input();
    const secondaryReceiptId = agentTaskCollectorReceiptId(
      "deployment-version",
      "deployment-version-endpoint",
    );
    const input: AgentTaskInput = {
      ...baseInput,
      checks: [
        ...(baseInput.checks ?? []),
        {
          id: "deployment-version",
          label: "Deployment version",
          required: true,
          evidenceRequirement: "A successful version endpoint response.",
          evidenceCollectors: [
            {
              id: "deployment-version-endpoint",
              kind: "command",
              argv: ["curl", "-fsS", "https://example.com/version"],
              output: "non-empty",
              expectation: { kind: "exit-code", passedExitCodes: [0] },
            },
          ],
        },
      ],
    };
    const payload = v2Payload([secondaryReceiptId]);
    const reportedCheck = payload.checks[0];
    if (reportedCheck === undefined) throw new Error("missing payload check");
    reportedCheck.id = "deployment-version";
    reportedCheck.summary = "The version endpoint returned successfully.";

    const normalized = normalizeAgentTaskV2Result(input, payload, [
      {
        id: COLLECTOR_RECEIPT_ID,
        source: "prometheus:service-health-endpoint",
        origin: "declared-collector",
        observedAt: OBSERVED_AT,
        status: "success",
        semanticStatus: "failed",
        excerpt: '{"status":"success","data":{"result":[0]}}',
      },
      {
        id: secondaryReceiptId,
        source: "declared-command:deployment-version-endpoint",
        origin: "declared-collector",
        observedAt: OBSERVED_AT,
        status: "success",
        semanticStatus: "passed",
        excerpt: '{"version":"2026.08.11"}',
      },
    ]);

    expect(normalized.execution).toBe("complete");
    expect(normalized.verdict).toBe("attention");
    expect(normalized.checks[0]?.status).toBe("failed");
    expect(normalized.checks[0]?.evidenceReceiptIds).toEqual([
      COLLECTOR_RECEIPT_ID,
    ]);
    expect(normalized.checks[0]?.summary).toContain(
      "Source-defined collector predicates failed",
    );
  });
});

describe("agent task deterministic verdicts", () => {
  test("derives verdicts from validated checks and findings", () => {
    const receipt = {
      id: COLLECTOR_RECEIPT_ID,
      source: "declared-command:service-health-endpoint",
      origin: "declared-collector" as const,
      observedAt: OBSERVED_AT,
      status: "success" as const,
      semanticStatus: "passed" as const,
      command: '["curl","-fsS","https://example.com/health"]',
    };
    const changedPayload = v2Payload([receipt.id]);
    changedPayload.findings = [
      {
        severity: "info",
        summary: "A tracked value changed",
        evidenceReceiptIds: [receipt.id],
      },
    ];
    const attentionPayload = v2Payload([receipt.id]);
    attentionPayload.findings = [
      {
        severity: "warning",
        summary: "A health condition needs attention",
        evidenceReceiptIds: [receipt.id],
      },
    ];

    expect(
      normalizeAgentTaskV2Result(v2Input(), changedPayload, [receipt]).verdict,
    ).toBe("changed");
    expect(
      normalizeAgentTaskV2Result(v2Input(), attentionPayload, [receipt])
        .verdict,
    ).toBe("attention");
  });
});
