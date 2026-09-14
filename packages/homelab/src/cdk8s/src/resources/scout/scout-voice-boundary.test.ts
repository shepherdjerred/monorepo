import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findResource,
  scoutResources,
} from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";
import { SPLIT_TOPOLOGY_STAGES } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/gateway.ts";

const EnvEntrySchema = z
  .object({
    name: z.string(),
    value: z.string().optional(),
    valueFrom: z.unknown().optional(),
  })
  .loose();

const DeploymentSpecSchema = z.object({
  template: z.object({
    spec: z.object({
      containers: z.array(
        z.object({
          env: z.array(EnvEntrySchema),
          volumeMounts: z.array(
            z.object({ name: z.string(), mountPath: z.string() }).loose(),
          ),
        }),
      ),
      volumes: z.array(
        z
          .object({
            name: z.string(),
            secret: z
              .object({
                secretName: z.string(),
                optional: z.boolean().optional(),
                items: z
                  .array(
                    z.object({ key: z.string(), path: z.string() }).loose(),
                  )
                  .optional(),
              })
              .optional(),
          })
          .loose(),
      ),
    }),
  }),
});

const VOICE_ENV_NAMES = [
  "OPENAI_API_KEY",
  "OPENAI_API_KEY_FILE",
  "VOICE_ASSETS_DIR",
  "VOICE_KWS_RUNTIME",
] as const;

const VOICE_RTP_EGRESS = {
  to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
  ports: [{ port: 50_000, endPort: 65_535, protocol: "UDP" }],
};

/**
 * The workload that owns voice for this stage.
 *
 * Voice is a gateway-role capability — the runtime capability table gives
 * voiceAssistant and voiceStateAccess to `combined` and `gateway` only — so it
 * lives in scout-gateway on a split stage and in the combined backend pod
 * everywhere else. These helpers resolve the owner rather than naming a pod, so
 * the assertions below stay about the invariant (voice is wired to whichever
 * pod holds the shard) instead of about the current topology.
 */
function voiceWorkloadName(stage: "beta" | "prod"): string {
  return SPLIT_TOPOLOGY_STAGES.includes(stage)
    ? `scout-${stage}-scout-gateway`
    : `scout-${stage}-scout-backend`;
}

function voiceEgressPolicyName(stage: "beta" | "prod"): string {
  return SPLIT_TOPOLOGY_STAGES.includes(stage)
    ? "scout-gateway-netpol"
    : "scout-egress-netpol";
}

function egressRules(stage: "beta" | "prod"): unknown[] {
  const policy = findResource(
    scoutResources(stage),
    "NetworkPolicy",
    voiceEgressPolicyName(stage),
  );
  return z.object({ egress: z.array(z.unknown()) }).parse(policy.spec).egress;
}

function deploymentNamed(stage: "beta" | "prod", name: string) {
  return DeploymentSpecSchema.parse(
    findResource(scoutResources(stage), "Deployment", name).spec,
  );
}

function containerOf(
  deployment: z.infer<typeof DeploymentSpecSchema>,
  label: string,
) {
  const container = deployment.template.spec.containers[0];
  if (container === undefined) {
    throw new Error(`Expected a ${label} container`);
  }
  return container;
}

function backendDeployment(stage: "beta" | "prod") {
  return deploymentNamed(stage, `scout-${stage}-scout-backend`);
}

function voiceDeployment(stage: "beta" | "prod") {
  return deploymentNamed(stage, voiceWorkloadName(stage));
}

function voiceEnv(stage: "beta" | "prod") {
  return containerOf(voiceDeployment(stage), voiceWorkloadName(stage)).env;
}

describe("Hey Scout voice deployment boundary", () => {
  /**
   * Pin the topology→owner mapping the rest of this file resolves through.
   *
   * Without this the helpers would faithfully follow a wrong
   * SPLIT_TOPOLOGY_STAGES and every assertion below would keep passing while
   * pointing at the wrong pod. Naming both expectations explicitly means a
   * change to the split membership has to come here and be looked at.
   */
  test("voice is owned by the gateway on a split stage and the backend on a combined one", () => {
    expect(SPLIT_TOPOLOGY_STAGES.includes("beta")).toBe(true);
    expect(voiceWorkloadName("beta")).toBe("scout-beta-scout-gateway");
    expect(voiceEgressPolicyName("beta")).toBe("scout-gateway-netpol");

    expect(SPLIT_TOPOLOGY_STAGES.includes("prod")).toBe(false);
    expect(voiceWorkloadName("prod")).toBe("scout-prod-scout-backend");
    expect(voiceEgressPolicyName("prod")).toBe("scout-egress-netpol");
  });

  test("beta carries the credential and bootstrap surface only", () => {
    const env = voiceEnv("beta");
    expect(env).toEqual(
      expect.arrayContaining([
        // Must match the Dockerfile's voice-models stage target; a mismatch
        // means the lazy load fails and `/scout join` reports it.
        expect.objectContaining({
          name: "VOICE_ASSETS_DIR",
          value: "/opt/scout/voice",
        }),
        expect.objectContaining({ name: "VOICE_KWS_RUNTIME", value: "auto" }),
        expect.objectContaining({
          name: "OPENAI_API_KEY_FILE",
          value: "/run/secrets/scout-openai/OPENAI_API_KEY",
        }),
      ]),
    );
  });

  // Activation belongs to the `voice_assistant_enabled` Flipt flag. A resurrected
  // env gate would silently take authority back from it.
  test("no environment sets an activation env gate", () => {
    for (const stage of ["beta", "prod"] as const) {
      expect(
        voiceEnv(stage).some(
          (entry) => entry.name === "VOICE_ASSISTANT_ENABLED",
        ),
      ).toBe(false);
    }
  });

  test("the beta OpenAI key is an updateable optional Secret volume", () => {
    const deployment = voiceDeployment("beta");
    const container = containerOf(deployment, voiceWorkloadName("beta"));
    expect(container.env.some((entry) => entry.name === "OPENAI_API_KEY")).toBe(
      false,
    );

    const mount = container.volumeMounts.find(
      (candidate) => candidate.mountPath === "/run/secrets/scout-openai",
    );
    expect(mount).toBeDefined();
    const volume = deployment.template.spec.volumes.find(
      (candidate) => candidate.name === mount?.name,
    );
    expect(volume?.secret).toEqual(
      expect.objectContaining({
        secretName: "scout-openai",
        optional: true,
      }),
    );
  });

  /**
   * The other half of moving voice onto the shard: the `application` role
   * declares voiceAssistant false, so on a split stage it must carry neither
   * the credential mount nor the bootstrap env. Leaving them behind would point
   * OPENAI_API_KEY_FILE at a path that pod does not mount, which looks like a
   * wired credential and is not one.
   */
  test("a split stage leaves no voice surface on the application pod", () => {
    for (const stage of ["beta", "prod"] as const) {
      if (!SPLIT_TOPOLOGY_STAGES.includes(stage)) continue;
      const deployment = backendDeployment(stage);
      const container = containerOf(deployment, `scout-${stage}-scout-backend`);
      const names = new Set(container.env.map((entry) => entry.name));
      for (const name of VOICE_ENV_NAMES) {
        expect(names.has(name)).toBe(false);
      }
      expect(
        container.volumeMounts.some(
          (candidate) => candidate.mountPath === "/run/secrets/scout-openai",
        ),
      ).toBe(false);
    }
  });

  test("beta references the dedicated scout-openai rotation unit", () => {
    const item = findResource(
      scoutResources("beta"),
      "OnePasswordItem",
      "scout-openai",
    );
    expect(JSON.stringify(item.spec)).toContain("scout-openai");
  });

  test("production sets no voice variable at all", () => {
    const names = new Set(voiceEnv("prod").map((entry) => entry.name));
    for (const name of VOICE_ENV_NAMES) {
      expect(names.has(name)).toBe(false);
    }
  });

  test("production provisions no OpenAI rotation unit", () => {
    expect(
      scoutResources("prod").some(
        (resource) =>
          resource.kind === "OnePasswordItem" &&
          resource.metadata.name === "scout-openai",
      ),
    ).toBe(false);
  });

  // A blocked media path is invisible: the voice websocket rides TCP/443 and
  // connects fine, so `/scout join` succeeds and then simply carries no audio.
  // That failure mode reads as a broken wake word, so assert the egress rule
  // rather than rediscovering it in a live session.
  test("beta egress permits Discord voice RTP over UDP", () => {
    expect(egressRules("beta")).toEqual(
      expect.arrayContaining([VOICE_RTP_EGRESS]),
    );
  });

  test("production gets no UDP egress beyond DNS", () => {
    expect(egressRules("prod")).not.toEqual(
      expect.arrayContaining([VOICE_RTP_EGRESS]),
    );
  });
});
