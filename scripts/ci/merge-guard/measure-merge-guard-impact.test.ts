import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  evaluateThresholds,
  summarizeMainPipelines,
  summarizePrPipelines,
  summarizeReceipts,
} from "./impact-model.ts";
import { runMeasureMergeGuardCli } from "./measure-merge-guard-impact.ts";

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("merge-guard impact model", () => {
  test("counts verify failure onset streaks separately from image-only main failures", () => {
    const summary = summarizeMainPipelines(
      [
        {
          number: 100,
          commit: "a".repeat(40),
          status: "success",
          event: "push",
          workflows: [{ name: "verify", state: "success" }],
        },
        {
          number: 101,
          commit: "b".repeat(40),
          status: "failure",
          event: "push",
          workflows: [{ name: "verify", state: "failure" }],
        },
        {
          number: 102,
          commit: "c".repeat(40),
          status: "failure",
          event: "push",
          workflows: [{ name: "verify", state: "failure" }],
        },
        {
          number: 103,
          commit: "d".repeat(40),
          status: "success",
          event: "push",
          workflows: [{ name: "verify", state: "success" }],
        },
        {
          number: 104,
          commit: "e".repeat(40),
          status: "failure",
          event: "push",
          workflows: [
            { name: "verify", state: "success" },
            { name: "images", state: "failure" },
          ],
        },
      ],
      7,
    );
    expect(summary).toEqual({
      pushPipelines: 5,
      completedVerifyPipelines: 5,
      verifyFailedPipelines: 2,
      verifyFailureOnsets: 1,
      verifyOnsetsPerDay: 1 / 7,
    });
  });

  test("measures post-green PR restacks, >=2 restacks, and skews caught on restack", () => {
    const prSummary = summarizePrPipelines([
      // PR #10: green once, never restacked
      {
        number: 1,
        commit: "1".repeat(40),
        status: "success",
        event: "pull_request",
        ref: "refs/pull/10/head",
        workflows: [],
      },
      // PR #11: green on head A, restacked onto head B which caught a verify failure, then fixed on head C
      {
        number: 2,
        commit: "a".repeat(40),
        status: "success",
        event: "pull_request",
        ref: "refs/pull/11/head",
        workflows: [],
      },
      {
        number: 3,
        commit: "b".repeat(40),
        status: "failure",
        event: "pull_request",
        ref: "refs/pull/11/head",
        workflows: [],
      },
      {
        number: 4,
        commit: "c".repeat(40),
        status: "success",
        event: "pull_request",
        ref: "refs/pull/11/head",
        workflows: [],
      },
      // Draft PR #12 ignored
      {
        number: 5,
        commit: "d".repeat(40),
        status: "success",
        event: "pull_request",
        pr_draft: true,
        ref: "refs/pull/12/head",
        workflows: [],
      },
    ]);
    expect(prSummary).toEqual({
      evaluatedPrs: 2,
      prsWithGreenHead: 2,
      postGreenRestackedPrs: 1,
      postGreenRestackRate: 0.5,
      twoPlusRestackedPrs: 1,
      twoPlusRestackRate: 0.5,
      skewsCaughtOnRestack: 1,
    });
  });

  test("evaluates KEEP vs ROLLBACK thresholds accurately", () => {
    const keepDecision = evaluateThresholds({
      main: {
        pushPipelines: 40,
        completedVerifyPipelines: 40,
        verifyFailedPipelines: 1,
        verifyFailureOnsets: 1,
        verifyOnsetsPerDay: 0.14,
      },
      pullRequests: {
        evaluatedPrs: 50,
        prsWithGreenHead: 50,
        postGreenRestackedPrs: 6,
        postGreenRestackRate: 0.12,
        twoPlusRestackedPrs: 1,
        twoPlusRestackRate: 0.02,
        skewsCaughtOnRestack: 2,
      },
      receipts: summarizeReceipts([], false, "/tmp/none"),
    });
    expect(keepDecision.verdict).toBe("KEEP");

    const rollbackDecision = evaluateThresholds({
      main: {
        pushPipelines: 10,
        completedVerifyPipelines: 10,
        verifyFailedPipelines: 0,
        verifyFailureOnsets: 0,
        verifyOnsetsPerDay: 0,
      },
      pullRequests: {
        evaluatedPrs: 20,
        prsWithGreenHead: 20,
        postGreenRestackedPrs: 8,
        postGreenRestackRate: 0.4,
        twoPlusRestackedPrs: 1,
        twoPlusRestackRate: 0.05,
        skewsCaughtOnRestack: 0,
      },
      receipts: summarizeReceipts([], false, "/tmp/none"),
    });
    expect(rollbackDecision.verdict).toBe("ROLLBACK");
    expect(rollbackDecision.rollbackActions.join("\n")).toContain(
      "--allow-stale-base",
    );
  });
});

describe("runMeasureMergeGuardCli", () => {
  test("queries Woodpecker + local pr-land.ndjson receipts and emits Markdown and JSON scorecards", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "merge-guard-cli-"));
    tempDirs.push(dir);
    const receiptsPath = path.join(dir, "pr-land.ndjson");
    const sampleReceipts = [
      {
        timestamp: "2026-11-25T10:00:00.000Z",
        pr: 5101,
        headSha: "1".repeat(40),
        mergeBaseSha: "2".repeat(40),
        mainHeadSha: "2".repeat(40),
        behindBy: 0,
        verdict: "up_to_date",
        bypassed: false,
        reasons: [],
      },
      {
        timestamp: "2026-11-25T12:00:00.000Z",
        pr: 5102,
        headSha: "3".repeat(40),
        mergeBaseSha: "2".repeat(40),
        mainHeadSha: "4".repeat(40),
        behindBy: 3,
        verdict: "disjoint_clean",
        bypassed: false,
        reasons: [],
      },
      {
        timestamp: "2026-11-25T14:00:00.000Z",
        pr: 5103,
        headSha: "5".repeat(40),
        mergeBaseSha: "2".repeat(40),
        mainHeadSha: "4".repeat(40),
        behindBy: 4,
        verdict: "stale_overlap",
        bypassed: false,
        reasons: ["workspace dependency overlap: @shepherdjerred/tracker"],
      },
    ];
    await Bun.write(
      receiptsPath,
      sampleReceipts.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );

    const createdSec = Math.floor(Date.parse("2026-11-25T12:00:00Z") / 1000);
    const fakeFetcher: typeof fetch = Object.assign(
      async (input: string | URL | Request): Promise<Response> => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        if (url.pathname.endsWith("/pipelines/201")) {
          return Response.json({
            number: 201,
            commit: "9".repeat(40),
            status: "failure",
            event: "push",
            branch: "main",
            created: createdSec,
            workflows: [{ name: "verify", state: "failure" }],
          });
        }
        const eventParam = url.searchParams.get("event") ?? "";
        if (eventParam === "push") {
          return Response.json([
            {
              number: 200,
              commit: "8".repeat(40),
              status: "success",
              event: "push",
              branch: "main",
              created: createdSec - 60,
            },
            {
              number: 201,
              commit: "9".repeat(40),
              status: "failure",
              event: "push",
              branch: "main",
              created: createdSec,
            },
          ]);
        }
        return Response.json(
          Array.from({ length: 10 }, (_, idx) => ({
            number: 300 + idx,
            commit: String(idx).repeat(40).slice(0, 40),
            status: "success",
            event: "pull_request",
            ref: `refs/pull/${String(5100 + idx)}/head`,
            created: createdSec,
          })),
        );
      },
      { preconnect: fetch.preconnect },
    );

    const outputs: string[] = [];
    const exitCode = await runMeasureMergeGuardCli(
      [
        "--since",
        "2026-11-24T00:00:00Z",
        "--until",
        "2026-11-26T00:00:00Z",
        "--receipts",
        receiptsPath,
      ],
      {
        environment: { WOODPECKER_TOKEN: "test-wp-token" },
        fetcher: fakeFetcher,
        writeOut: (text) => outputs.push(text),
      },
    );
    expect(exitCode).toBe(0);
    expect(outputs[0]).toContain("## Merge-Guard Impact Scorecard");
    expect(outputs[0]).toContain("Disjoint behind-`main` merges allowed");

    const jsonOutputs: string[] = [];
    const jsonExit = await runMeasureMergeGuardCli(
      [
        "--since",
        "2026-11-24T00:00:00Z",
        "--until",
        "2026-11-26T00:00:00Z",
        "--receipts",
        receiptsPath,
        "--json",
      ],
      {
        environment: { WOODPECKER_TOKEN: "test-wp-token" },
        fetcher: fakeFetcher,
        writeOut: (text) => jsonOutputs.push(text),
      },
    );
    expect(jsonExit).toBe(0);
    expect(jsonOutputs[0]).toContain('"staleBlocked": 1');
    expect(jsonOutputs[0]).toContain('"disjointClean": 1');
  });
});
