import { expect, test } from "vitest";
import type { V1Job } from "@kubernetes/client-node";
import { ContentRecoveryNativeReceiptSchema } from "@shepherdjerred/delivery/contract";
import {
  FORUM_RECOVERY_ANNOTATIONS as annotations,
  ForumReleaseIdSchema,
} from "@shepherdjerred/ops-model/forum-recovery.ts";
import { forumJobFingerprint, forumRecoveryChild } from "./forum-jobs.ts";

function original() {
  const job = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      namespace: "storm-forum",
      name: "storm-forum-release-0123456789ab",
      uid: crypto.randomUUID(),
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 3600,
      template: {
        metadata: { labels: { app: "storm-forum", component: "release" } },
        spec: {
          restartPolicy: "Never",
          serviceAccountName: "storm-forum-worker",
          automountServiceAccountToken: false,
          initContainers: [
            {
              name: "assemble",
              image: `docker.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`,
              command: ["bun", "/opt/storm-forum/src/cli.ts", "assemble"],
            },
          ],
          containers: [
            {
              name: "release",
              image: `docker.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`,
              command: ["bun", "/opt/storm-forum/src/cli.ts", "release"],
              env: [
                { name: "FORUM_RELEASE_ID", value: "0123456789ab" },
                {
                  name: "DB_PASSWORD",
                  valueFrom: {
                    secretKeyRef: {
                      name: "original-secrets",
                      key: "DB_PASSWORD",
                    },
                  },
                },
                {
                  name: "FORUM_RECOVERY_INTENT_ID",
                  valueFrom: {
                    fieldRef: {
                      fieldPath: `metadata.annotations['${annotations.intent}']`,
                    },
                  },
                },
              ],
            },
          ],
          volumes: [
            {
              name: "files",
              persistentVolumeClaim: { claimName: "storm-forum-files" },
            },
          ],
        },
      },
    },
  } satisfies V1Job;
  const receipt = ContentRecoveryNativeReceiptSchema.shape.receipt.parse({
    namespace: "storm-forum",
    name: job.metadata?.name,
    uid: job.metadata?.uid,
    specFingerprint: forumJobFingerprint(job),
    requestId: "original/release",
  });
  return { job, receipt };
}

test("manual child is a suspended exact original PodSpec with only fixed intent/action annotations", () => {
  const { job, receipt } = original();
  const child = forumRecoveryChild({
    original: job,
    receipt,
    intentId: "operator/non-uuid",
    action: "repair",
    attempt: 1,
  });
  expect(child.spec?.suspend).toBe(true);
  expect(child.spec?.template.spec).toEqual(job.spec?.template.spec);
  expect(child.spec?.template.metadata?.annotations).toEqual({
    [annotations.intent]: "operator/non-uuid",
    [annotations.action]: "repair",
  });
  expect(child.metadata?.annotations?.[annotations.originalUID]).toBe(
    receipt.uid,
  );
  expect(child.spec?.parallelism).toBe(1);
  expect(child.spec?.completions).toBe(1);
  expect(
    forumRecoveryChild({
      original: job,
      receipt,
      intentId: "operator/non-uuid",
      action: "inspect",
      attempt: 2,
    }).metadata?.name,
  ).not.toBe(child.metadata?.name);
  expect(() =>
    forumRecoveryChild({
      original: {
        ...job,
        metadata: { ...job.metadata, uid: crypto.randomUUID() },
      },
      receipt,
      intentId: "operator/non-uuid",
      action: "repair",
      attempt: 1,
    }),
  ).toThrow("changed");
});

test("execution-policy defaults are normalized but extra parallel writers and altered original Pod bytes change fingerprint", () => {
  const { job } = original();
  expect(
    forumJobFingerprint({
      ...job,
      spec: { ...job.spec, parallelism: 1, completions: 1 },
    }),
  ).toBe(forumJobFingerprint(job));
  for (const changed of [
    { ...job, spec: { ...job.spec, parallelism: 2 } },
    { ...job, spec: { ...job.spec, completions: 2 } },
    { ...job, spec: { ...job.spec, podFailurePolicy: { rules: [] } } },
    {
      ...job,
      spec: {
        ...job.spec,
        template: {
          ...job.spec?.template,
          spec: {
            ...job.spec?.template.spec,
            serviceAccountName: "foreign-account",
          },
        },
      },
    },
    {
      ...job,
      spec: {
        ...job.spec,
        template: {
          ...job.spec?.template,
          spec: {
            ...job.spec?.template.spec,
            containers: [
              {
                name: "release",
                image: "foreign-image",
                env: [{ name: "DB_PASSWORD", value: "injected" }],
              },
            ],
          },
        },
      },
    },
    {
      ...job,
      spec: {
        ...job.spec,
        template: {
          ...job.spec?.template,
          spec: {
            ...job.spec?.template.spec,
            volumes: [{ name: "files", hostPath: { path: "/" } }],
          },
        },
      },
    },
  ])
    expect(forumJobFingerprint(changed)).not.toBe(forumJobFingerprint(job));
});

test("native producer accepts existing operator12 and Delivery32 release identifiers only", () => {
  expect(ForumReleaseIdSchema.parse("a".repeat(12))).toHaveLength(12);
  expect(ForumReleaseIdSchema.parse("b".repeat(32))).toHaveLength(32);
  for (const invalid of [
    "../journal",
    "a".repeat(13),
    "b".repeat(31),
    "G".repeat(32),
  ])
    expect(ForumReleaseIdSchema.safeParse(invalid).success).toBe(false);
});
