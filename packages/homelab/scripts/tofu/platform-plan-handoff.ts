/** Encrypted, build-scoped handoff between a reviewed platform plan and apply. */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { z } from "zod";
import {
  ciHandoffConfigFromEnv,
  readRequiredHandoff,
  writeJsonHandoff,
} from "@shepherdjerred/root-scripts/lib/ci/ci-handoff.ts";
import { commitSha } from "@shepherdjerred/root-scripts/lib/ci/ci-environment.ts";
import { requireEnv } from "@shepherdjerred/root-scripts/lib/run.ts";
import type { PlatformStack } from "#scripts/platform-desired-state.ts";

const PLAN_AGE_LIMIT_MS = 24 * 60 * 60 * 1000;
const PIPELINE_NUMBER = /^[1-9]\d*$/u;
const HEX_SHA256 = /^[a-f\d]{64}$/u;
const PLAN_KEY = "platform-saved-plan";

const SavedPlanSchema = z.strictObject({
  version: z.literal(1),
  stack: z.enum(["openai", "anthropic", "discord", "cloudflare-tokens"]),
  commit: z.string().regex(/^[a-f\d]{40}$/u),
  pipeline: z.string().regex(PIPELINE_NUMBER),
  createdAt: z.number().int().positive(),
  sha256: z.string().regex(HEX_SHA256),
  salt: z.string(),
  iv: z.string(),
  tag: z.string(),
  ciphertext: z.string(),
});

function encryptionKey(salt: Buffer): Buffer {
  // The state passphrase is already a required, stack-specific 1Password
  // secret. A separate salt and KDF domain keep plan encryption independent
  // of OpenTofu's state encryption while avoiding another platform credential.
  return scryptSync(
    requireEnv("TOFU_STATE_ENCRYPTION_PASSPHRASE"),
    Buffer.concat([Buffer.from("woodpecker-platform-plan-v1:"), salt]),
    32,
    { N: 1 << 15, maxmem: 64 * 1024 * 1024 },
  );
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function associatedData(identity: {
  readonly stack: PlatformStack;
  readonly commit: string;
  readonly pipeline: string;
  readonly createdAt: number;
  readonly sha256: string;
}): Buffer {
  const { stack, commit, pipeline, createdAt, sha256 } = identity;
  return Buffer.from(
    JSON.stringify([1, stack, commit, pipeline, createdAt, sha256]),
  );
}

export async function publishPlatformPlan(
  stack: PlatformStack,
  planPath: string,
): Promise<void> {
  const config = ciHandoffConfigFromEnv();
  const commit = commitSha();
  const createdAt = Date.now();
  const plaintext = Buffer.from(await Bun.file(planPath).arrayBuffer());
  const sha256 = digest(plaintext);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(salt), iv);
  cipher.setAAD(
    associatedData({
      stack,
      commit,
      pipeline: config.pipelineNumber,
      createdAt,
      sha256,
    }),
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  await writeJsonHandoff(PLAN_KEY, {
    version: 1,
    stack,
    commit,
    pipeline: config.pipelineNumber,
    createdAt,
    sha256,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
  console.log(
    `Saved encrypted ${stack} plan in pipeline ${config.pipelineNumber}; SHA-256 ${sha256}. Review this pipeline's plan output before triggering apply.`,
  );
}

export async function loadReviewedPlatformPlan(
  stack: PlatformStack,
  sourcePipeline: string,
  planPath: string,
): Promise<void> {
  const current = ciHandoffConfigFromEnv();
  if (
    !PIPELINE_NUMBER.test(sourcePipeline) ||
    Number(sourcePipeline) >= Number(current.pipelineNumber)
  ) {
    throw new Error("the reviewed plan must come from an earlier pipeline");
  }
  const source = { ...current, pipelineNumber: sourcePipeline };
  const saved = SavedPlanSchema.parse(
    JSON.parse(await readRequiredHandoff(PLAN_KEY, source)),
  );
  if (
    saved.stack !== stack ||
    saved.commit !== commitSha() ||
    saved.pipeline !== sourcePipeline
  ) {
    throw new Error("reviewed plan stack, commit, or pipeline does not match");
  }
  const age = Date.now() - saved.createdAt;
  if (age < 0 || age > PLAN_AGE_LIMIT_MS) {
    throw new Error("reviewed plan is outside its 24-hour approval window");
  }
  const salt = Buffer.from(saved.salt, "base64");
  const iv = Buffer.from(saved.iv, "base64");
  const tag = Buffer.from(saved.tag, "base64");
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) {
    throw new Error("reviewed plan encryption metadata is invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(salt), iv);
  decipher.setAAD(associatedData(saved));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(saved.ciphertext, "base64")),
    decipher.final(),
  ]);
  if (digest(plaintext) !== saved.sha256) {
    throw new Error("reviewed plan digest does not match");
  }
  await Bun.write(planPath, plaintext);
  console.log(
    `Applying reviewed ${stack} plan from pipeline ${sourcePipeline}; SHA-256 ${saved.sha256}.`,
  );
}

export async function consumeReviewedPlatformPlan(
  sourcePipeline: string,
): Promise<void> {
  const config = ciHandoffConfigFromEnv();
  // PUT is already authorized for this handoff identity. Replace the encrypted
  // bytes with a harmless marker so the plan cannot be loaded a second time.
  await writeJsonHandoff(
    PLAN_KEY,
    { consumed: true },
    { ...config, pipelineNumber: sourcePipeline },
  );
}
