import { merge } from "lodash";
import type { ContainerProps, Deployment } from "cdk8s-plus-31";
import { EnvValue } from "cdk8s-plus-31";
import { ApiObject, JsonPatch } from "cdk8s";

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

export function withCommonProps(props: ContainerProps): ContainerProps {
  return merge({}, commonProps, props);
}

export function setRevisionHistoryLimit(deployment: Deployment, limit = 3) {
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/revisionHistoryLimit", limit),
  );
}
