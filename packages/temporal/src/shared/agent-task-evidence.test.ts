import { describe, expect, test } from "bun:test";
import type { AgentTaskInput, AgentTaskResultPayloadV2 } from "./agent-task.ts";
import {
  extractAgentTaskEvidenceReceipts,
  normalizeAgentTaskV2Result,
} from "./agent-task-evidence.ts";

const OBSERVED_AT = "2026-08-10T17:00:00.000Z";

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
      status: "success",
      exitCode: 0,
    });
  });

  test("downgrades unsupported clean claims to partial and inconclusive", () => {
    const normalized = normalizeAgentTaskV2Result(v2Input(), v2Payload([]), []);
    expect(normalized.execution).toBe("partial");
    expect(normalized.verdict).toBe("inconclusive");
    expect(normalized.checks[0]?.status).toBe("failed");
    expect(normalized.limitations).toContain(
      "Check service-health has no successful captured evidence.",
    );
  });

  test("permits clean only with successful captured evidence", () => {
    const normalized = normalizeAgentTaskV2Result(
      v2Input(),
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
    expect(normalized.execution).toBe("complete");
    expect(normalized.verdict).toBe("clear");
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
    const payload = v2Payload(["tool-1"]);
    payload.findings = [
      {
        severity: "warning",
        summary: "Unsupported claim",
        evidenceReceiptIds: [],
      },
    ];
    const normalized = normalizeAgentTaskV2Result(v2Input(), payload, [
      {
        id: "tool-1",
        source: "Bash",
        observedAt: OBSERVED_AT,
        status: "success",
      },
    ]);
    expect(normalized.execution).toBe("partial");
    expect(normalized.limitations).toContain(
      'Finding "Unsupported claim" lacks complete successful captured evidence.',
    );
    expect(normalized.findings).toEqual([]);
  });
});

describe("agent task deterministic verdicts", () => {
  test("derives verdicts from validated checks and findings", () => {
    const receipt = {
      id: "tool-1",
      source: "Bash",
      observedAt: OBSERVED_AT,
      status: "success" as const,
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
