import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findResource,
  scoutResources,
} from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";

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

function egressRules(stage: "beta" | "prod"): unknown[] {
  const policy = findResource(
    scoutResources(stage),
    "NetworkPolicy",
    "scout-egress-netpol",
  );
  return z.object({ egress: z.array(z.unknown()) }).parse(policy.spec).egress;
}

function backendDeployment(stage: "beta" | "prod") {
  return DeploymentSpecSchema.parse(
    findResource(
      scoutResources(stage),
      "Deployment",
      `scout-${stage}-scout-backend`,
    ).spec,
  );
}

function backendEnv(stage: "beta" | "prod") {
  const deployment = backendDeployment(stage);
  const container = deployment.template.spec.containers[0];
  if (container === undefined) {
    throw new Error(`Expected a scout-${stage} backend container`);
  }
  return container.env;
}

describe("Hey Scout voice deployment boundary", () => {
  test("beta carries the credential and bootstrap surface only", () => {
    const env = backendEnv("beta");
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
        backendEnv(stage).some(
          (entry) => entry.name === "VOICE_ASSISTANT_ENABLED",
        ),
      ).toBe(false);
    }
  });

  test("the beta OpenAI key is an updateable optional Secret volume", () => {
    const deployment = backendDeployment("beta");
    const container = deployment.template.spec.containers[0];
    if (container === undefined) {
      throw new Error("Expected a scout-beta backend container");
    }
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

  test("beta references the dedicated scout-openai rotation unit", () => {
    const item = findResource(
      scoutResources("beta"),
      "OnePasswordItem",
      "scout-openai",
    );
    expect(JSON.stringify(item.spec)).toContain("scout-openai");
  });

  test("production sets no voice variable at all", () => {
    const names = new Set(backendEnv("prod").map((entry) => entry.name));
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
