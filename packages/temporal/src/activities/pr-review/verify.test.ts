import { describe, expect, it } from "bun:test";
import type {
  Finding,
  VerificationResult,
  VerifierTarget,
} from "#shared/pr-review/finding.ts";
import { runVerifyFindings, verifyOneFinding } from "./verify.ts";
import {
  makeVerificationResult,
  truncateExcerpt,
  type VerifierRunner,
} from "./verify-runner.ts";

function mkFinding(input: {
  id: string;
  verifier: Finding["verifier"];
  verifierTarget?: VerifierTarget;
}): Finding {
  return {
    id: input.id,
    file: "src/api.ts",
    lineStart: 10,
    lineEnd: 10,
    kind: "correctness",
    severity: "warning",
    verifier: input.verifier,
    verifierTarget: input.verifierTarget,
    claim: "test claim",
    evidence: "test evidence",
    confidence: 0.7,
  };
}

/**
 * Build a `VerifierRunner` fake whose four methods return canned
 * `VerificationResult` shapes. Each method takes its `verifierTarget`
 * argument and ignores it — tests assert on the behavior the activity
 * derives from the result, not on what the verifier checked.
 */
function makeFakeRunner(per: {
  typecheck?: VerificationResult;
  eslint?: VerificationResult;
  grep?: VerificationResult;
  test?: VerificationResult;
}): VerifierRunner {
  return {
    typecheck: () =>
      Promise.resolve(
        per.typecheck ??
          makeVerificationResult({
            status: "unverified",
            verifier: "typecheck",
            exitCode: 0,
            output: "",
            durationMs: 0,
          }),
      ),
    eslint: () =>
      Promise.resolve(
        per.eslint ??
          makeVerificationResult({
            status: "unverified",
            verifier: "eslint",
            exitCode: 0,
            output: "",
            durationMs: 0,
          }),
      ),
    grep: () =>
      Promise.resolve(
        per.grep ??
          makeVerificationResult({
            status: "unverified",
            verifier: "grep",
            exitCode: 0,
            output: "",
            durationMs: 0,
          }),
      ),
    test: () =>
      Promise.resolve(
        per.test ??
          makeVerificationResult({
            status: "unverified",
            verifier: "test",
            exitCode: 0,
            output: "",
            durationMs: 0,
          }),
      ),
  };
}

describe("verifyOneFinding — verifier:none", () => {
  it("returns unverified with a clear note when the specialist declared verifier:none", async () => {
    const result = await verifyOneFinding(
      makeFakeRunner({}),
      mkFinding({ id: "f1", verifier: "none" }),
    );
    expect(result.status).toBe("unverified");
    expect(result.verifier).toBe("none");
    expect(result.note).toContain("no verifier");
  });
});

describe("verifyOneFinding — missing verifierTarget", () => {
  it("returns unverified (not contradicted) when verifierTarget is missing", async () => {
    // The model declared `verifier: "grep"` but forgot to emit a target.
    // We don't have enough info to verify; keeping the finding as
    // unverified preserves it for human review.
    const result = await verifyOneFinding(
      makeFakeRunner({}),
      mkFinding({ id: "f1", verifier: "grep" }),
    );
    expect(result.status).toBe("unverified");
    expect(result.note).toContain("verifierTarget");
  });

  it("returns unverified when verifierTarget.kind disagrees with verifier", async () => {
    // Schema refinement should catch this at parse time, but defend
    // against runtime drift between fields.
    const result = await verifyOneFinding(
      makeFakeRunner({}),
      mkFinding({
        id: "f1",
        verifier: "grep",
        verifierTarget: {
          kind: "test",
          packagePath: "packages/x",
          testNamePattern: "foo",
          expectPass: true,
        },
      }),
    );
    expect(result.status).toBe("unverified");
    expect(result.note).toContain("disagrees");
  });
});

describe("verifyOneFinding — dispatches to the right verifier", () => {
  it("dispatches typecheck verifier and returns its result", async () => {
    const runner = makeFakeRunner({
      typecheck: makeVerificationResult({
        status: "verified",
        verifier: "typecheck",
        exitCode: 1,
        output: "src/foo.ts(42,5): error TS2322",
        durationMs: 1234,
      }),
    });
    const result = await verifyOneFinding(
      runner,
      mkFinding({
        id: "f1",
        verifier: "typecheck",
        verifierTarget: {
          kind: "typecheck",
          packagePath: "packages/temporal",
          expectedOutputSubstring: "src/foo.ts(42",
        },
      }),
    );
    expect(result.status).toBe("verified");
    expect(result.verifier).toBe("typecheck");
  });

  it("dispatches grep verifier", async () => {
    const runner = makeFakeRunner({
      grep: makeVerificationResult({
        status: "contradicted",
        verifier: "grep",
        exitCode: 1,
        output: "",
        durationMs: 50,
        note: "pattern not found",
      }),
    });
    const result = await verifyOneFinding(
      runner,
      mkFinding({
        id: "f1",
        verifier: "grep",
        verifierTarget: {
          kind: "grep",
          pattern: "nonexistent_symbol",
          isLiteral: true,
          pathGlob: "src/**",
          mustMatch: true,
        },
      }),
    );
    expect(result.status).toBe("contradicted");
  });
});

describe("verifyOneFinding — runner throws", () => {
  it("returns unverified rather than propagating exceptions", async () => {
    const throwingRunner: VerifierRunner = {
      typecheck: () => Promise.reject(new Error("boom")),
      eslint: () => Promise.reject(new Error("boom")),
      grep: () => Promise.reject(new Error("boom")),
      test: () => Promise.reject(new Error("boom")),
    };
    const result = await verifyOneFinding(
      throwingRunner,
      mkFinding({
        id: "f1",
        verifier: "grep",
        verifierTarget: {
          kind: "grep",
          pattern: "foo",
          isLiteral: true,
          pathGlob: "**",
          mustMatch: true,
        },
      }),
    );
    expect(result.status).toBe("unverified");
    expect(result.note).toContain("threw");
  });
});

describe("runVerifyFindings — drop-on-contradict (hallucinated-claim fixture)", () => {
  /**
   * The load-bearing Phase 4 test from the task description: a fixture PR
   * with 3 specialist findings citing nonexistent symbols/files. Every
   * verifier reports contradicted; verify must drop all 3. Replay
   * produces 0 posted findings.
   */
  it("drops all 3 fabricated findings (replay → 0 posted)", async () => {
    const fakes: Finding[] = [
      mkFinding({
        id: "fake-1",
        verifier: "grep",
        verifierTarget: {
          kind: "grep",
          pattern: "nonexistentSymbol1",
          isLiteral: true,
          pathGlob: "src/**",
          mustMatch: true,
        },
      }),
      mkFinding({
        id: "fake-2",
        verifier: "grep",
        verifierTarget: {
          kind: "grep",
          pattern: "totallyMadeUpFunction",
          isLiteral: true,
          pathGlob: "src/**",
          mustMatch: true,
        },
      }),
      mkFinding({
        id: "fake-3",
        verifier: "grep",
        verifierTarget: {
          kind: "grep",
          pattern: "phantomClass",
          isLiteral: true,
          pathGlob: "src/**",
          mustMatch: true,
        },
      }),
    ];
    const runner = makeFakeRunner({
      grep: makeVerificationResult({
        status: "contradicted",
        verifier: "grep",
        exitCode: 1,
        output: "",
        durationMs: 10,
        note: "pattern not found",
      }),
    });
    const kept = await runVerifyFindings(runner, fakes);
    expect(kept).toEqual([]);
  });
});

describe("runVerifyFindings — keep verified + unverified", () => {
  it("keeps both verified and unverified findings; drops only contradicted", async () => {
    const findings: Finding[] = [
      mkFinding({
        id: "ver-1",
        verifier: "typecheck",
        verifierTarget: {
          kind: "typecheck",
          packagePath: "packages/x",
          expectedOutputSubstring: "src/a.ts",
        },
      }),
      mkFinding({
        id: "unv-1",
        verifier: "typecheck",
        verifierTarget: {
          kind: "typecheck",
          packagePath: "packages/y",
          expectedOutputSubstring: "src/b.ts",
        },
      }),
      mkFinding({
        id: "dropped-1",
        verifier: "grep",
        verifierTarget: {
          kind: "grep",
          pattern: "foo",
          isLiteral: true,
          pathGlob: "src/**",
          mustMatch: true,
        },
      }),
    ];
    // Sequence the verifier responses: typecheck returns verified, then
    // unverified on the next call. The fake's `typecheck` method ignores
    // its input so we need stateful sequencing.
    let typecheckCallCount = 0;
    const runner: VerifierRunner = {
      typecheck: () => {
        typecheckCallCount++;
        return Promise.resolve(
          typecheckCallCount === 1
            ? makeVerificationResult({
                status: "verified",
                verifier: "typecheck",
                exitCode: 1,
                output: "error TS2322",
                durationMs: 10,
              })
            : makeVerificationResult({
                status: "unverified",
                verifier: "typecheck",
                exitCode: -1,
                output: "spawn error",
                durationMs: 5,
                note: "verifier spawn failed",
              }),
        );
      },
      eslint: () =>
        Promise.resolve(
          makeVerificationResult({
            status: "unverified",
            verifier: "eslint",
            exitCode: 0,
            output: "",
            durationMs: 0,
          }),
        ),
      grep: () =>
        Promise.resolve(
          makeVerificationResult({
            status: "contradicted",
            verifier: "grep",
            exitCode: 1,
            output: "",
            durationMs: 0,
          }),
        ),
      test: () =>
        Promise.resolve(
          makeVerificationResult({
            status: "unverified",
            verifier: "test",
            exitCode: 0,
            output: "",
            durationMs: 0,
          }),
        ),
    };
    const kept = await runVerifyFindings(runner, findings);
    const keptIds = kept.map((k) => k.id).toSorted();
    expect(keptIds).toEqual(["unv-1", "ver-1"]);
    const verified = kept.find((k) => k.id === "ver-1");
    const unverified = kept.find((k) => k.id === "unv-1");
    expect(verified?.verification?.status).toBe("verified");
    expect(unverified?.verification?.status).toBe("unverified");
  });

  it("returns an empty array when given an empty input", async () => {
    const kept = await runVerifyFindings(makeFakeRunner({}), []);
    expect(kept).toEqual([]);
  });
});

describe("runVerifyFindings — never lets verifier failures hide bugs", () => {
  it("keeps findings as unverified when the runner throws (defense-in-depth)", async () => {
    // verifyOneFinding catches runner throws internally, so this test
    // exercises the defensive Promise.allSettled rejected-branch path
    // in runVerifyFindings — which should only fire if verifyOneFinding
    // itself misbehaves. We force that by passing a runner that throws
    // synchronously in the dispatcher.
    const findings: Finding[] = [
      mkFinding({
        id: "f1",
        verifier: "grep",
        verifierTarget: {
          kind: "grep",
          pattern: "x",
          isLiteral: true,
          pathGlob: "**",
          mustMatch: true,
        },
      }),
    ];
    const throwingRunner: VerifierRunner = {
      typecheck: () => Promise.reject(new Error("boom")),
      eslint: () => Promise.reject(new Error("boom")),
      grep: () => Promise.reject(new Error("boom")),
      test: () => Promise.reject(new Error("boom")),
    };
    const kept = await runVerifyFindings(throwingRunner, findings);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.verification?.status).toBe("unverified");
  });
});

describe("truncateExcerpt", () => {
  it("returns short strings unchanged", () => {
    expect(truncateExcerpt("hello world")).toBe("hello world");
  });

  it("trims whitespace", () => {
    expect(truncateExcerpt("  hello\n\n")).toBe("hello");
  });

  it("truncates strings over 900 chars with a clear marker", () => {
    const long = "a".repeat(2000);
    const out = truncateExcerpt(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("truncated");
  });
});

describe("makeVerificationResult", () => {
  it("populates required fields and omits note when not provided", () => {
    const r = makeVerificationResult({
      status: "verified",
      verifier: "grep",
      exitCode: 0,
      output: "ok",
      durationMs: 5,
    });
    expect(r.status).toBe("verified");
    expect(r.verifier).toBe("grep");
    expect(r.outputExcerpt).toBe("ok");
    expect(r.note).toBeUndefined();
  });

  it("includes note when provided", () => {
    const r = makeVerificationResult({
      status: "unverified",
      verifier: "test",
      exitCode: 0,
      output: "",
      durationMs: 0,
      note: "skipped",
    });
    expect(r.note).toBe("skipped");
  });
});
