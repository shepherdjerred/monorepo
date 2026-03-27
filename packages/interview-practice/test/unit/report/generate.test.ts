import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { z } from "zod/v4";
import { Database } from "bun:sqlite";
import { initializeSchema } from "#lib/db/schema.ts";
import { insertEvent } from "#lib/db/events.ts";
import { insertTranscript } from "#lib/db/transcript.ts";
import {
  generateReport,
  formatReport,
  reportToJson,
} from "#lib/report/generate.ts";
import type { SessionMetadata } from "#lib/session/schemas.ts";

let db: Database;

const baseMetadata: SessionMetadata = {
  id: "00000000-0000-0000-0000-000000000001",
  type: "leetcode",
  questionId: "00000000-0000-0000-0000-000000000002",
  questionTitle: "Two Sum",
  status: "completed",
  startedAt: "2026-01-15T10:00:00.000Z",
  endedAt: "2026-01-15T10:25:00.000Z",
  currentPart: 1,
  language: "ts",
  workspacePath: "/tmp/test-session",
  voiceEnabled: false,
  mode: "text_ai",
  timer: {
    durationMs: 25 * 60 * 1000,
    elapsedMs: 15 * 60 * 1000,
    warningsEmitted: ["50%"],
    lastCheckpointMs: Date.now(),
  },
  hintsGiven: 2,
  testsRun: 3,
  editsGiven: 0,
  debugHelpsGiven: 0,
};

beforeEach(() => {
  db = new Database(":memory:");
  initializeSchema(db);
});

afterEach(() => {
  db.close();
});

describe("report generation", () => {
  test("generates report from empty session", () => {
    const report = generateReport(db, baseMetadata);

    expect(report.sessionId).toBe(baseMetadata.id);
    expect(report.questionTitle).toBe("Two Sum");
    expect(report.language).toBe("ts");
    expect(report.status).toBe("completed");
    expect(report.turns).toBe(0);
    expect(report.hintsGiven).toBe(2);
    expect(report.testsRun).toBe(3);
    expect(report.durationSeconds).toBe(15 * 60);
  });

  test("counts turns and aggregates metrics", () => {
    insertEvent(db, "turn", { latencyMs: 200, tokensIn: 100, tokensOut: 50 });
    insertEvent(db, "turn", { latencyMs: 400, tokensIn: 200, tokensOut: 100 });
    insertEvent(db, "turn", { latencyMs: 300, tokensIn: 150, tokensOut: 75 });

    const report = generateReport(db, baseMetadata);

    expect(report.turns).toBe(3);
    expect(report.avgLatencyMs).toBe(300);
    expect(report.totalTokensIn).toBe(450);
    expect(report.totalTokensOut).toBe(225);
    expect(report.estimatedCostUsd).toBeGreaterThan(0);
  });

  test("counts test passes and failures", () => {
    insertEvent(db, "test_run", { passed: 3, failed: 2, total: 5 });
    insertEvent(db, "test_run", { passed: 5, failed: 0, total: 5 });

    const report = generateReport(db, baseMetadata);

    expect(report.testsPassed).toBe(8);
    expect(report.testsFailed).toBe(2);
  });

  test("counts parts revealed", () => {
    insertEvent(db, "part_revealed", { partNumber: 2 });
    insertEvent(db, "part_revealed", { partNumber: 3 });

    const report = generateReport(db, baseMetadata);
    expect(report.partsRevealed).toBe(2);
  });

  test("counts transcript entries", () => {
    insertTranscript(db, "user", "Hello");
    insertTranscript(db, "interviewer", "Welcome");
    insertTranscript(db, "user", "I think we should use a hash map");

    const report = generateReport(db, baseMetadata);
    expect(report.transcriptLength).toBe(3);
  });
});

describe("report formatting", () => {
  test("formatReport returns readable string", () => {
    insertEvent(db, "turn", { latencyMs: 250, tokensIn: 100, tokensOut: 50 });

    const report = generateReport(db, baseMetadata);
    const formatted = formatReport(report);

    expect(formatted).toContain("Session Report");
    expect(formatted).toContain("Two Sum");
    expect(formatted).toContain("ts");
    expect(formatted).toContain("completed");
  });

  test("reportToJson returns valid JSON", () => {
    const report = generateReport(db, baseMetadata);
    const json = reportToJson(report);
    const parsed = JSON.parse(json) as unknown;
    const obj = z.record(z.string(), z.unknown()).parse(parsed);

    expect(obj["sessionId"]).toBe(baseMetadata.id);
    expect(obj["questionTitle"]).toBe("Two Sum");
  });
});
