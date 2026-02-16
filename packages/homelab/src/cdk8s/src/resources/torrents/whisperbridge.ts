import { Cpu, Deployment, DeploymentStrategy, EnvValue, Secret, Service } from "cdk8s-plus-31";
import { Chart, Size } from "cdk8s";
import { withCommonProps, ROOT_UID, ROOT_GID } from "../../misc/common.ts";
import versions from "../../versions.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";

export function createWhisperbridgeDeployment(chart: Chart) {
  // OnePassword item for Groq API key
  const groqSecrets = new OnePasswordItem(chart, "groq-secrets", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/uaem4aeb4divtzkgtn3azu2wna",
    },
  });

  const deployment = new Deployment(chart, "whisperbridge", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root": "Whisperbridge requires root for container operations",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Whisperbridge requires writable filesystem for runtime data",
      },
    },
  });

  deployment.addContainer(
    withCommonProps({
      image: `mccloud/bazarr-openai-whisperbridge:${versions["mccloud/bazarr-openai-whisperbridge"]}`,
      portNumber: 9000,
      securityContext: {
        user: ROOT_UID,
        group: ROOT_GID,
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      envVariables: {
        OPENAI_API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "groq-api-key", groqSecrets.name),
          key: "credential",
        }),
        OPENAI_BASE_URL: EnvValue.fromValue("https://api.groq.com/openai/v1"),
      },
      resources: {
        cpu: {
          request: Cpu.millis(10),
          limit: Cpu.millis(500),
        },
        memory: {
          request: Size.mebibytes(64),
          limit: Size.mebibytes(256),
        },
      },
    }),
  );

  new Service(chart, "whisperbridge-service", {
    selector: deployment,
    ports: [{ port: 9000 }],
  });
}
