import { randomInt } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AnswerKey, Ballot, Digest, Review, preferenceResult } from "./gate.ts";

export const sha = (bytes: string | Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
export const digestFile = async (file: string) =>
  sha(new Uint8Array(await Bun.file(file).arrayBuffer()));
export const jsonText = (value: unknown) =>
  JSON.stringify(value, null, 2) + "\n";
export const readJson = async (file: string): Promise<unknown> =>
  JSON.parse(await readFile(file, "utf8"));

/** Exclusive, fsynced evidence cannot be overwritten by a competing owner. */
export async function seal(file: string, bytes: string) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const parent = await open(path.dirname(file), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

const Plan = z
  .object({
    version: z.literal(1),
    actor_sha256: Digest,
    files: z
      .array(z.object({ file: z.string().min(1), sha256: Digest }).strict())
      .min(1),
    pairs: z
      .array(
        z
          .object({
            pair: z.number().int().min(1).max(20),
            learned: z.string().min(1),
            authored: z.string().min(1),
          })
          .strict(),
      )
      .length(20),
  })
  .strict();
export type PreferencePlan = z.infer<typeof Plan>;
const Claim = z.object({ output: z.string(), plan_sha256: Digest }).strict();
const Pack = z.object({ review_sha256: Digest, key_sha256: Digest }).strict();

async function verifyFiles(files: PreferencePlan["files"]) {
  for (const file of files)
    if ((await digestFile(file.file)) !== file.sha256)
      throw new Error(`blind preference input changed: ${file.file}`);
}

/** Private plans/keys stay outside the public directory supplied to the reviewer. */
export class PreferenceLedger {
  private constructor(
    readonly output: string,
    readonly claimFile: string,
  ) {}

  static async create(output: string, claimFile: string, rawPlan: unknown) {
    const plan = Plan.parse(rawPlan);
    if (
      plan.pairs.some((pair, index) => pair.pair !== index + 1) ||
      new Set(plan.files.map((file) => file.file)).size !== plan.files.length
    )
      throw new Error(
        "blind preference plan has duplicate or unordered inputs",
      );
    for (const pair of plan.pairs)
      if (
        ![pair.learned, pair.authored].every((clip) =>
          plan.files.some((file) => file.file === clip),
        )
      )
        throw new Error(
          "blind preference video is not frozen in the input plan",
        );
    await verifyFiles(plan.files);
    const text = jsonText(plan);
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(output, { mode: 0o700 });
    // Claim before exposing a randomized pack. An interrupted pack needs repair,
    // never an automatic reroll with a different output or answer key.
    await seal(claimFile, jsonText({ output, plan_sha256: sha(text) }));
    await seal(path.join(output, "plan.json"), text);
    return new PreferenceLedger(output, claimFile);
  }

  static async read(output: string, claimFile: string) {
    const ledger = new PreferenceLedger(output, claimFile);
    await ledger.plan();
    return ledger;
  }

  private async plan() {
    const claim = Claim.parse(await readJson(this.claimFile));
    const file = path.join(this.output, "plan.json");
    if (
      claim.output !== this.output ||
      (await digestFile(file)) !== claim.plan_sha256
    )
      throw new Error("blind preference claim differs from the frozen plan");
    const plan = Plan.parse(await readJson(file));
    await verifyFiles(plan.files);
    return plan;
  }

  async pack(normalize: (input: string, output: string) => Promise<void>) {
    const plan = await this.plan();
    await seal(
      path.join(this.output, "pack.claimed.json"),
      jsonText({ version: 1 }),
    );
    const publicDir = path.join(this.output, "public");
    await mkdir(publicDir);
    const labels = plan.pairs.map((pair) => ({
      pair: pair.pair,
      learned: randomInt(2) === 0 ? ("A" as const) : ("B" as const),
    }));
    // Freeze the mapping before encoding or revealing any footage.
    await seal(path.join(this.output, "labels.json"), jsonText(labels));
    const pairs: Review["pairs"] = [];
    for (const [index, pair] of plan.pairs.entries()) {
      const learned = labels[index]?.learned;
      if (learned === undefined) throw new Error("missing frozen blind label");
      const make = async (label: "A" | "B") => {
        const file = `pair-${pair.pair.toString().padStart(2, "0")}-${label}.mp4`;
        const target = path.join(publicDir, file);
        await normalize(
          label === learned ? pair.learned : pair.authored,
          target,
        );
        return { file, sha256: await digestFile(target) };
      };
      pairs.push({
        pair: pair.pair,
        subject: index % 2 === 0 ? "red fighter" : "blue fighter",
        A: await make("A"),
        B: await make("B"),
      });
    }
    if (
      new Set(pairs.flatMap((pair) => [pair.A.sha256, pair.B.sha256])).size !==
      40
    )
      throw new Error("blind pack reuses normalized footage");
    await this.plan();
    const review = Review.parse({
      version: 1,
      question:
        "Which version of the indicated fighter behaves more like a human player?",
      choices: ["A", "B", "tie"],
      pairs,
    });
    const reviewText = jsonText(review);
    const reviewSha = sha(reviewText);
    const key = AnswerKey.parse({
      version: 1,
      actor_sha256: plan.actor_sha256,
      review_sha256: reviewSha,
      pairs: labels,
    });
    const keyText = jsonText(key);
    await seal(path.join(this.output, "key.json"), keyText);
    await seal(
      path.join(this.output, "pack.json"),
      jsonText({
        review_sha256: reviewSha,
        key_sha256: sha(keyText),
      }),
    );
    await seal(path.join(publicDir, "review.json"), reviewText);
    await seal(
      path.join(publicDir, "answers.json"),
      jsonText({
        version: 1,
        review_sha256: reviewSha,
        source: "manual-human-review",
        answers: pairs.map((pair) => ({
          pair: pair.pair,
          choice: null,
          reason: "",
        })),
      }),
    );
  }

  async score(answersFile: string) {
    const plan = await this.plan();
    const pack = Pack.parse(
      await readJson(path.join(this.output, "pack.json")),
    );
    const publicDir = path.join(this.output, "public");
    const reviewFile = path.join(publicDir, "review.json");
    const keyFile = path.join(this.output, "key.json");
    if (
      (await digestFile(reviewFile)) !== pack.review_sha256 ||
      (await digestFile(keyFile)) !== pack.key_sha256
    )
      throw new Error("blind pack or private answer key changed");
    const review = Review.parse(await readJson(reviewFile));
    const key = AnswerKey.parse(await readJson(keyFile));
    if (
      key.actor_sha256 !== plan.actor_sha256 ||
      key.review_sha256 !== pack.review_sha256
    )
      throw new Error("blind review does not refer to the frozen actor");
    for (const pair of review.pairs)
      for (const clip of [pair.A, pair.B])
        if ((await digestFile(path.join(publicDir, clip.file))) !== clip.sha256)
          throw new Error("blind review footage changed");
    const ballot = Ballot.parse(await readJson(answersFile));
    const result = preferenceResult(review, key, ballot);
    await seal(path.join(this.output, "answers.sealed.json"), jsonText(ballot));
    const evidence = {
      ...result,
      plan_sha256: await digestFile(path.join(this.output, "plan.json")),
      key_sha256: pack.key_sha256,
      ballot_sha256: sha(jsonText(ballot)),
    };
    await seal(
      path.join(this.output, "preference-result.json"),
      jsonText(evidence),
    );
    return evidence;
  }
}
