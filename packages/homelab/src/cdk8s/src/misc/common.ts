import { merge } from "lodash";
import type { ContainerProps, DeploymentProps } from "cdk8s-plus-31";
import { Deployment, EnvValue } from "cdk8s-plus-31";
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
