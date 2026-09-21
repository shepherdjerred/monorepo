import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findResource,
  scoutResources,
} from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";
import {
  gatewayTopologyRunsRole,
  SCOUT_GATEWAY_TOPOLOGY,
} from "@shepherdjerred/homelab/cdk8s/src/resources/scout/topology.ts";

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
  return gatewayTopologyRunsRole(SCOUT_GATEWAY_TOPOLOGY[stage])
    ? `scout-${stage}-scout-gateway`
    : `scout-${stage}-scout-backend`;
}

function voiceEgressPolicyName(stage: "beta" | "prod"): string {
  return gatewayTopologyRunsRole(SCOUT_GATEWAY_TOPOLOGY[stage])
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
   * SCOUT_GATEWAY_TOPOLOGY and every assertion below would keep passing while
   * pointing at the wrong pod. Naming both expectations explicitly means a
   * change to a stage's topology has to come here and be looked at.
   */
  test("voice is owned by the gateway on a split stage and the backend on a combined one", () => {
    expect(gatewayTopologyRunsRole(SCOUT_GATEWAY_TOPOLOGY.beta)).toBe(true);
    expect(voiceWorkloadName("beta")).toBe("scout-beta-scout-gateway");
    expect(voiceEgressPolicyName("beta")).toBe("scout-gateway-netpol");

    expect(gatewayTopologyRunsRole(SCOUT_GATEWAY_TOPOLOGY.prod)).toBe(false);
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

  /**
   * `optional: true` is deliberate and load-bearing. Please do not "fix" it.
   *
   * It reads like a violation of the fail-fast secrets rule, and has been
   * raised as one. It is not, for three reasons that live in the backend:
   *
   * 1. An absent credential is a DESIGNED state, not a failure.
   *    `voice-assistant/runtime.ts#resolveVoiceCredential` explicitly handles
   *    the file not existing, and `loadRuntime` then returns the status
   *    `unconfigured`, whose own doc says it "is not a fault" and is kept
   *    distinct from `failed` precisely so a missing credential is never
   *    mistaken for a broken asset set. `/scout join` branches on it and tells
   *    the user.
   * 2. Voice is NOT a boot step. `runtime/plan.ts` records that models load
   *    lazily on first `/scout join`, because activation is the
   *    `voice_assistant_enabled` Flipt flag and a boot-time gate "would only
   *    take the pod down"; the asset set is verified in the image's
   *    `voice-smoke` build stage, which fails the build rather than the pod.
   * 3. Since the runtime-role split this volume lives on the GATEWAY pod,
   *    which owns the Discord shard. A required Secret leaves a pod
   *    unschedulable until the Secret exists, so requiring it here would take
   *    the whole bot — every slash command, not just voice — offline whenever
   *    `scout-openai` is missing or mid-rotation, in exchange for a flag-gated
   *    optional feature. That is a strictly larger blast radius than the
   *    designed fail-at-command behaviour.
   *
   * The real gap — that "up, but voice unconfigured" is invisible until
   * someone runs `/scout join` — is an observability problem, recorded as a
   * follow-up for a voice-runtime-status gauge. It is not solved by making the
   * shard unschedulable.
   */
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
    // Asserted on its own as well, so a flip to required fails on the exact
    // property that matters and lands the reader on the reasoning above rather
    // than on a whole-object shape mismatch.
    expect(volume?.secret?.optional).toBe(true);
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
      if (!gatewayTopologyRunsRole(SCOUT_GATEWAY_TOPOLOGY[stage])) continue;
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
