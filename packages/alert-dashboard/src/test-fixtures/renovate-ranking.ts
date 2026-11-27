import type {
  RankedRenovateUpdate,
  RenovateRankedQueue,
  RenovateTarget,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";

const SCANNED_AT = "2026-11-26T11:00:00Z";
const JS_TARGET: RenovateTarget = {
  manager: "npm",
  datasource: "npm",
  packageName: "hono",
  filePath: "packages/golink/package.json",
  currentValue: "^4.12.18",
  targetValue: "^4.13.0",
  currentVersion: "4.12.18",
  targetVersion: "4.13.0",
  currentDigest: null,
  digest: null,
};
const READY: RankedRenovateUpdate["bake"] = {
  state: "ready",
  eligibleAt: "2026-11-25T14:00:00Z",
  reason: "The target release has passed the configured minimum age.",
};

function candidate(input: {
  name: string;
  target: Partial<RenovateTarget>;
  assessment: Partial<Omit<RankedRenovateUpdate, "id" | "name" | "targets">>;
}): RankedRenovateUpdate {
  return {
    id: input.name,
    name: input.name,
    ecosystem: "npm",
    targets: [{ ...JS_TARGET, packageName: input.name, ...input.target }],
    urgency: "medium",
    effort: "s",
    needed: true,
    rationale: "The tracked release updates a dependency in active use.",
    evidenceUrls: [],
    bake: READY,
    blockers: [],
    ...input.assessment,
  };
}

export const FIXTURE_RENOVATE_RANKING: RenovateRankedQueue = {
  snapshot: {
    scannedAt: SCANNED_AT,
    baseSha: "725a3c4fa49d58fd0b448d7b8b6726af37bfa610",
    coverage: "partial",
    warnings: ["Registry lookup failed for one Docker package."],
    candidates: [
      candidate({
        name: "Prisma",
        target: {
          packageName: "@prisma/client",
          filePath: "packages/alert-dashboard/package.json",
          currentValue: "^7.10.1",
          targetValue: "^8.0.0",
          currentVersion: "7.10.1",
          targetVersion: "8.0.0",
        },
        assessment: { effort: "m" },
      }),
      candidate({
        name: "TypeScript ESLint",
        target: {
          packageName: "typescript-eslint",
          filePath: "packages/eslint-config/package.json",
          currentValue: "^8.72.2",
          targetValue: "^8.74.0",
          currentVersion: "8.72.2",
          targetVersion: "8.74.0",
        },
        assessment: { urgency: "low", effort: "m" },
      }),
      candidate({
        name: "Hono",
        target: JS_TARGET,
        assessment: {
          urgency: "high",
          effort: "xs",
          rationale:
            "The updated client fixes request handling in a shared API dependency.",
          evidenceUrls: ["https://github.com/honojs/hono/releases"],
        },
      }),
      candidate({
        name: "Vitest",
        target: {
          currentValue: "^5.0.5",
          targetValue: "^5.1.0",
          currentVersion: "5.0.5",
          targetVersion: "5.1.0",
          filePath: "packages/alert-dashboard/package.json",
        },
        assessment: {
          bake: {
            state: "waiting",
            eligibleAt: "2026-12-08T14:00:00Z",
            reason: "Waiting for the configured release age.",
          },
        },
      }),
      candidate({
        name: "PostHog SDK",
        target: {
          packageName: "posthog-node",
          filePath: "packages/streambot/package.json",
          currentValue: "^5.0.0",
          targetValue: "^6.0.5",
          currentVersion: "5.0.0",
          targetVersion: "6.0.5",
        },
        assessment: { urgency: "low" },
      }),
    ],
  },
  dispositions: {
    Prisma: {
      status: "blocked",
      reason: "Migration requires changes across several runtime clients.",
      revisedEffort: "l",
      updatedAt: SCANNED_AT,
    },
    "TypeScript ESLint": {
      status: "merged",
      reason: "The reviewed bundle is on main.",
      updatedAt: SCANNED_AT,
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/5165",
    },
    "PostHog SDK": {
      status: "published",
      reason: "The JavaScript libraries bundle is awaiting review.",
      updatedAt: SCANNED_AT,
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/5007",
    },
  },
};
