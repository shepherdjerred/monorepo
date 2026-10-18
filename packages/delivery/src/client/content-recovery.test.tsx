import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ContentRecoveryIntentSchema,
  PipelineDefinitionSchema,
  type PipelineDefinition,
  type ContentRecoveryIntent,
} from "#shared/contract.ts";
import { ContentRecovery } from "./content-recovery.tsx";

function renderRecovery(
  definition: PipelineDefinition,
  intent: ContentRecoveryIntent,
) {
  return renderToStaticMarkup(
    <ContentRecovery
      detail={{
        pipeline: { definition },
        deployment: {
          id: "content/failed",
          recoveryRequired: true,
          versionSetRevisionId: "content/release/exact",
        },
        environment: { generation: 4 },
        contentRecoveries: [intent],
      }}
    />,
  );
}

test.each([
  ["static/glitter-boys", "sites", "site", "glitter-boys"],
  ["specialized/storm-forum", "forum", "forum", "storm-forum"],
  ["specialized/scout-beta", "sites", "site", "scout-beta"],
] as const)(
  "%s exposes the held operation and native refusal without offering unsafe acceptance",
  async (registration, domain, label, target) => {
    const definition = PipelineDefinitionSchema.parse(
      await Bun.file(
        new URL(
          `../../registrations/${registration}/pipeline.json`,
          import.meta.url,
        ),
      ).json(),
    );
    const intent = ContentRecoveryIntentSchema.parse({
      id: "content/recovery/refused",
      deploymentId: "content/failed",
      requestedBy: "admin",
      reason: "Inspect the immutable held release and its native owner",
      expectedEnvironmentGeneration: 4,
      snapshotFingerprint: "a".repeat(64),
      status: "failed",
      targetKind: domain === "forum" ? "forum" : "static-site",
      message: "Original executor remains active; ownership retained",
      submittedAt: null,
      createdAt: "2026-10-17T00:00:00Z",
      finishedAt: "2026-10-17T00:01:00Z",
      dispatchBarrier: {
        adapter: "control-plane-dispatch-barrier/v1",
        deploymentUID: "original-producer-uid",
        templateFingerprint: "c".repeat(64),
        priorReplicas: 1,
        podUIDs: ["original-producer-pod"],
        replicaSetUIDs: ["original-producer-replicaset"],
      },
      nativeReceipts:
        domain === "forum"
          ? [
              {
                action: "original",
                receipt: {
                  namespace: "storm-forum",
                  name: "storm-forum-release-original",
                  uid: "81716b2a-415d-49bc-adbd-aadf761050aa",
                  requestId: "content/failed",
                  specFingerprint: "b".repeat(64),
                },
              },
            ]
          : [],
    });
    const html = renderRecovery(definition, intent);
    expect(html).toContain(`Independent ${label} recovery`);
    expect(html).toContain(
      `toolkit deploy ${domain} recover content/failed --machine --expected-generation 4`,
    );
    expect(html).toContain(target);
    expect(html).toContain("content/release/exact");
    expect(html).toContain(intent.snapshotFingerprint);
    if (domain === "forum") {
      expect(html).toContain("storm-forum-release-original");
      expect(html).toContain("81716b2a-415d-49bc-adbd-aadf761050aa");
    }
    expect(html).toContain(intent.message);
    expect(html).toContain("preserves the failed release and accepted version");
    expect(html).not.toContain("<button");
    expect(html).toContain("Pending producer restoration");
    expect(
      renderRecovery(definition, { ...intent, status: "succeeded" }),
    ).toContain("Pending producer restoration");
    expect(
      renderRecovery(definition, {
        ...intent,
        barrierRestoredAt: "2026-10-17T00:02:00Z",
      }),
    ).not.toContain("Pending producer restoration");
  },
);
