import type { Database } from "bun:sqlite";
import { z } from "zod/v4";
import type { SessionMetadata } from "#lib/session/schemas.ts";
import { countEvents, avgMetric, queryEvents } from "#lib/db/events.ts";
import { getAllTranscript } from "#lib/db/transcript.ts";

export type SessionReport = {
  sessionId: string;
  questionTitle: string;
  difficulty: string;
  language: string;
  status: string;
  startedAt: string;
  endedAt: string | undefined;
  durationSeconds: number;
  turns: number;
  hintsGiven: number;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  partsRevealed: number;
  avgLatencyMs: number | null;
  totalTokensIn: number;
  totalTokensOut: number;
  estimatedCostUsd: number;
  transcriptLength: number;
};

const SumSchema = z.object({ total: z.number().nullable() });

const TestRunDataSchema = z.object({
  passed: z.number().optional(),
  failed: z.number().optional(),
});

function sumMetric(
  db: Database,
  eventType: string,
  jsonPath: string,
): number {
  const stmt = db.prepare(
    `SELECT COALESCE(SUM(json_extract(data, ?)), 0) as total FROM events WHERE event = ? AND json_extract(data, ?) IS NOT NULL`,
  );
  const raw = stmt.get(jsonPath, eventType, jsonPath);
  if (raw == null) return 0;
  const row = SumSchema.parse(raw);
  return row.total ?? 0;
}

function estimateCost(tokensIn: number, tokensOut: number): number {
  // Rough estimate based on Claude Sonnet pricing: $3/M in, $15/M out
  return (tokensIn / 1_000_000) * 3 + (tokensOut / 1_000_000) * 15;
}

export function generateReport(
  db: Database,
  metadata: SessionMetadata,
): SessionReport {
  const turns = countEvents(db, "turn");
  const testRuns = queryEvents(db, "test_run", 1000);

  let testsPassed = 0;
  let testsFailed = 0;
  for (const event of testRuns) {
    if (event.data !== null) {
      try {
        const parsed = JSON.parse(event.data) as unknown;
        const data = TestRunDataSchema.parse(parsed);
        testsPassed += data.passed ?? 0;
        testsFailed += data.failed ?? 0;
      } catch {
        // skip malformed event data
      }
    }
  }

  const partsRevealed = countEvents(db, "part_revealed");
  const avgLatency = avgMetric(db, "turn", "$.latencyMs");
  const totalTokensIn = sumMetric(db, "turn", "$.tokensIn");
  const totalTokensOut = sumMetric(db, "turn", "$.tokensOut");
  const transcript = getAllTranscript(db);

  const elapsedMs = metadata.timer.elapsedMs;
  const durationSeconds = Math.floor(elapsedMs / 1000);

  return {
    sessionId: metadata.id,
    questionTitle: metadata.questionTitle,
    difficulty: metadata.type === "leetcode" ? "leetcode" : "system-design",
    language: metadata.language,
    status: metadata.status,
    startedAt: metadata.startedAt,
    endedAt: metadata.endedAt,
    durationSeconds,
    turns,
    hintsGiven: metadata.hintsGiven,
    testsRun: metadata.testsRun,
    testsPassed,
    testsFailed,
    partsRevealed,
    avgLatencyMs: avgLatency,
    totalTokensIn,
    totalTokensOut,
    estimatedCostUsd: estimateCost(totalTokensIn, totalTokensOut),
    transcriptLength: transcript.length,
  };
}

export function formatReport(report: SessionReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(
    "\u001B[1m═══════════════════════════════════════════════════\u001B[0m",
  );
  lines.push("\u001B[1m  Session Report\u001B[0m");
  lines.push(
    "\u001B[1m═══════════════════════════════════════════════════\u001B[0m",
  );
  lines.push("");
  lines.push(`  Question:    ${report.questionTitle}`);
  lines.push(`  Language:    ${report.language}`);
  lines.push(`  Status:      ${report.status}`);
  lines.push(`  Started:     ${report.startedAt}`);
  if (report.endedAt !== undefined) {
    lines.push(`  Ended:       ${report.endedAt}`);
  }
  lines.push("");

  const minutes = Math.floor(report.durationSeconds / 60);
  const seconds = report.durationSeconds % 60;
  lines.push(
    `  Duration:    ${String(minutes)}:${String(seconds).padStart(2, "0")}`,
  );
  lines.push(`  Turns:       ${String(report.turns)}`);
  lines.push(`  Hints:       ${String(report.hintsGiven)}`);
  lines.push(`  Tests Run:   ${String(report.testsRun)}`);
  lines.push(
    `  Tests:       ${String(report.testsPassed)} passed, ${String(report.testsFailed)} failed`,
  );
  lines.push(`  Parts:       ${String(report.partsRevealed)} revealed`);
  lines.push("");

  if (report.avgLatencyMs !== null) {
    lines.push(
      `  Avg Latency: ${String(Math.round(report.avgLatencyMs))}ms`,
    );
  }
  lines.push(`  Tokens In:   ${String(report.totalTokensIn)}`);
  lines.push(`  Tokens Out:  ${String(report.totalTokensOut)}`);
  lines.push(`  Est. Cost:   $${report.estimatedCostUsd.toFixed(4)}`);
  lines.push(`  Transcript:  ${String(report.transcriptLength)} entries`);
  lines.push("");
  lines.push(
    "\u001B[1m═══════════════════════════════════════════════════\u001B[0m",
  );

  return lines.join("\n");
}

export function reportToJson(report: SessionReport): string {
  return JSON.stringify(report, null, 2);
}
