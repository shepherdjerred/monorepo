import { Testing } from "cdk8s";
import { Deployment } from "cdk8s-plus-31";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { authenticatedGatewayContainerDefaults } from "./authenticated-gateway-container.ts";
import { restrictedContainer } from "./common.ts";
import { linuxServerPod } from "./linux-server.ts";

const Workload = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.object({
    template: z.object({
      spec: z.object({
        securityContext: z.looseObject({ fsGroup: z.number().optional() }),
        containers: z
          .array(
            z.object({ securityContext: z.record(z.string(), z.unknown()) }),
          )
          .length(1),
      }),
    }),
  }),
});

function render(props: ConstructorParameters<typeof Deployment>[2]) {
  const chart = Testing.chart();
  new Deployment(chart, "workload", props);
  const [workload] = Testing.synth(chart).flatMap((document) => {
    const parsed = Workload.safeParse(document);
    return parsed.success ? [parsed.data] : [];
  });
  if (workload === undefined) throw new Error("no Deployment was rendered");
  return workload;
}

const RESTRICTED = {
  runAsNonRoot: true,
  readOnlyRootFilesystem: true,
  allowPrivilegeEscalation: false,
  privileged: false,
  capabilities: { drop: ["ALL"] },
  seccompProfile: { type: "RuntimeDefault" },
};

function containerSecurityContext(
  securityContext: ReturnType<typeof restrictedContainer>,
) {
  return render({ containers: [{ image: "example", securityContext }] }).spec
    .template.spec.containers[0]?.securityContext;
}

describe("restrictedContainer", () => {
  test("runs as the given non-root user with no privileges to gain", () => {
    expect(containerSecurityContext(restrictedContainer(1000))).toEqual({
      ...RESTRICTED,
      runAsUser: 1000,
      runAsGroup: 1000,
    });
  });

  test("the group defaults to the user and can differ", () => {
    expect(containerSecurityContext(restrictedContainer(100, 1000))).toEqual({
      ...RESTRICTED,
      runAsUser: 100,
      runAsGroup: 1000,
    });
  });

  test("the auth gateway defaults are the restricted context", () => {
    expect(
      authenticatedGatewayContainerDefaults(65_532).securityContext,
    ).toEqual(restrictedContainer(65_532, 1000));
  });
});

describe("linuxServerPod", () => {
  const annotations = {
    "ignore-check.kube-linter.io/run-as-non-root":
      "LinuxServer.io images run as root internally",
    "ignore-check.kube-linter.io/no-read-only-root-fs":
      "LinuxServer.io images require writable filesystem",
  };

  test("carries the kube-linter exemptions and leaves volume ownership alone", () => {
    const workload = render({
      ...linuxServerPod(),
      containers: [{ image: "example" }],
    });
    expect(workload.metadata.annotations).toEqual(annotations);
    expect(workload.spec.template.spec.securityContext.fsGroup).toBeUndefined();
  });

  test("with fsGroup, mounted volumes are owned by the LinuxServer group", () => {
    const workload = render({
      ...linuxServerPod({ fsGroup: true }),
      containers: [{ image: "example" }],
    });
    expect(workload.metadata.annotations).toEqual(annotations);
    expect(workload.spec.template.spec.securityContext.fsGroup).toBe(1000);
  });
});
