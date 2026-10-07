import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnswerKey, Review } from "./gate.ts";
import {
  PreferenceLedger,
  digestFile,
  jsonText,
  readJson,
  sha,
} from "./ledger.ts";
import type { PreferencePlan } from "./ledger.ts";

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "rwf-blind-unit-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const pairs: PreferencePlan["pairs"] = [];
  const files: PreferencePlan["files"] = [];
  for (let pair = 1; pair <= 20; pair++) {
    const learned = path.join(directory, `source-learned-${pair.toString()}`);
    const authored = path.join(directory, `source-authored-${pair.toString()}`);
    // Deliberately text, not footage: these test ledger ownership, never human likeness.
    for (const file of [learned, authored]) {
      await writeFile(file, `unit fixture ${path.basename(file)}`);
      files.push({ file, sha256: await digestFile(file) });
    }
    pairs.push({ pair, learned, authored });
  }
  const output = path.join(directory, "review");
  const claim = path.join(directory, "blind-preference.claimed.json");
  const plan = { version: 1, actor_sha256: sha("unit actor"), files, pairs };
  return { output, claim, plan };
}
async function answers(output: string, learnedVotes = 15) {
  const key = AnswerKey.parse(await readJson(path.join(output, "key.json")));
  const target = path.join(directory, "unit-answers.json");
  await writeFile(
    target,
    jsonText({
      version: 1,
      review_sha256: key.review_sha256,
      source: "manual-human-review",
      answers: key.pairs.map((pair, index) => ({
        pair: pair.pair,
        choice: index < learnedVotes ? pair.learned : "tie",
        reason: "unit ballot",
      })),
    }),
  );
  return target;
}

describe("immutable blind review ownership", () => {
  it("publishes only opaque labels and scores once with artifact fingerprints", async () => {
    const { output, claim, plan } = await fixture();
    const ledger = await PreferenceLedger.create(output, claim, plan);
    await ledger.pack(copyFile);
    const reviewFile = path.join(output, "public/review.json");
    const text = await readFile(reviewFile, "utf8");
    expect(text).not.toContain("learned");
    expect(text).not.toContain("authored");
    expect(text).not.toContain(directory);
    const review = Review.parse(JSON.parse(text));
    expect(review.pairs).toHaveLength(20);
    const result = await ledger.score(await answers(output));
    expect(result).toMatchObject({
      passed: true,
      learnedVotes: 15,
      ties: 5,
      acceptance: "unaccepted",
    });
    expect(result.review_sha256).toBe(await digestFile(reviewFile));
    expect(result.plan_sha256).toBe(
      await digestFile(path.join(output, "plan.json")),
    );
    await expect(ledger.score(await answers(output, 20))).rejects.toThrow();
    expect(await readJson(path.join(output, "preference-result.json"))).toEqual(
      result,
    );
  });

  it("prevents concurrent owners or another output from rerolling a pilot review", async () => {
    const { output, claim, plan } = await fixture();
    const results = await Promise.allSettled([
      PreferenceLedger.create(output, claim, plan),
      PreferenceLedger.create(path.join(directory, "alternative"), claim, plan),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  it("an interrupted pack stays claimed, rather than silently drawing another key", async () => {
    const { output, claim, plan } = await fixture();
    const ledger = await PreferenceLedger.create(output, claim, plan);
    await expect(
      ledger.pack(() => Promise.reject(new Error("encoding interrupted"))),
    ).rejects.toThrow("interrupted");
    const labels = await readFile(path.join(output, "labels.json"), "utf8");
    await expect(ledger.pack(copyFile)).rejects.toThrow();
    expect(await readFile(path.join(output, "labels.json"), "utf8")).toBe(
      labels,
    );
  });

  it("detects source, plan, private-key and public footage tampering before scoring", async () => {
    const { output, claim, plan } = await fixture();
    const ledger = await PreferenceLedger.create(output, claim, plan);
    await ledger.pack(copyFile);
    const ballot = await answers(output);
    const targets = [
      plan.pairs[0]?.learned,
      path.join(output, "plan.json"),
      path.join(output, "key.json"),
      path.join(output, "public/pair-01-A.mp4"),
      path.join(output, "public/review.json"),
    ];
    for (const target of targets) {
      if (target === undefined) throw new Error("unit source is missing");
      const original = await readFile(target);
      await writeFile(target, "tampered unit evidence");
      await expect(ledger.score(ballot)).rejects.toThrow();
      await writeFile(target, original);
    }
    const result = await ledger.score(ballot);
    expect(result.passed).toBe(true);
  });

  it("incomplete ballots do not consume a review; a complete failed vote remains final", async () => {
    const { output, claim, plan } = await fixture();
    const ledger = await PreferenceLedger.create(output, claim, plan);
    await ledger.pack(copyFile);
    await expect(
      ledger.score(path.join(output, "public/answers.json")),
    ).rejects.toThrow();
    const result = await ledger.score(await answers(output, 14));
    expect(result).toMatchObject({ passed: false, learnedVotes: 14, ties: 6 });
    await expect(ledger.score(await answers(output, 20))).rejects.toThrow();
    expect(await readJson(path.join(output, "preference-result.json"))).toEqual(
      result,
    );
  });
});
