import { merge } from "lodash";
import type {
  ContainerProps,
  ContainerSecurityContextProps,
  DeploymentProps,
} from "cdk8s-plus-31";
import {
  Capability,
  Deployment,
  EnvValue,
  SeccompProfileType,
} from "cdk8s-plus-31";
import { ApiObject, JsonPatch, type Chart } from "cdk8s";
import { BURST_SERVICE_PRIORITY } from "./priority-classes.ts";

export const ROOT_UID = 0;
export const ROOT_GID = 0;

const commonEnv = {
  TZ: EnvValue.fromValue("America/Los_Angeles"),
};

// Deliberately NO `resources` here: a hidden `resources: {}` made every
// container that didn't override it silently BestEffort. Each call site must
// declare its own resources (enforced by the require-container-resources
// ESLint rule); `resources: {}` at a call site is the visible BestEffort
// opt-in.
export const commonProps: Partial<ContainerProps> = {
  envVariables: commonEnv,
};

/**
 * Merge common container props with caller-supplied props.
 *
 * NOTE: This function name (`withCommonProps`) is registered in the
 * `PROPS_WRAPPERS` set in `packages/eslint-config/src/rules/require-container-resources.ts`.
 * If you rename this function or add a new wrapper, update that set too so the
 * ESLint rule can look through the wrapper to find the props literal.
 */
export function withCommonProps(props: ContainerProps): ContainerProps {
  return merge({}, commonProps, props);
}

/**
 * The least-privilege container security context: a fixed non-root user, a
 * read-only root filesystem, no privilege escalation, every capability dropped
 * and the runtime's default seccomp profile.
 *
 * A container that must write somewhere mounts a volume there; one that cannot
 * run this way spreads the preset and overrides the single field it needs, so
 * the exception is visible at the call site.
 */
export function restrictedContainer(
  uid: number,
  gid: number = uid,
): ContainerSecurityContextProps {
  return {
    user: uid,
    group: gid,
    ensureNonRoot: true,
    readOnlyRootFilesystem: true,
    allowPrivilegeEscalation: false,
    privileged: false,
    capabilities: { drop: [Capability.ALL] },
    seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
  };
}

export function setRevisionHistoryLimit(deployment: Deployment, limit = 3) {
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/revisionHistoryLimit", limit),
  );
}

export function setDeploymentPriorityClass(
  deployment: Deployment,
  priorityClassName: string,
) {
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/priorityClassName", priorityClassName),
  );
}

export function createBurstDeployment(
  chart: Chart,
  name: string,
  props: DeploymentProps,
): Deployment {
  const deployment = new Deployment(chart, name, props);
  setDeploymentPriorityClass(deployment, BURST_SERVICE_PRIORITY);
  return deployment;
}
