import { Size } from "cdk8s";
import { Cpu } from "cdk8s-plus-31";

export function temporalUtilityContainerDefaults() {
  return {
    securityContext: {
      user: 1000,
      group: 1000,
      ensureNonRoot: true,
      readOnlyRootFilesystem: false,
    },
    resources: {
      cpu: {
        request: Cpu.millis(50),
        limit: Cpu.millis(250),
      },
      memory: {
        request: Size.mebibytes(64),
        limit: Size.mebibytes(256),
      },
    },
  };
}
