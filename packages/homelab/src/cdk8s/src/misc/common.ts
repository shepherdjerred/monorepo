import { merge } from "lodash";
import type { ContainerProps, Deployment } from "cdk8s-plus-31";
import { EnvValue } from "cdk8s-plus-31";
import { ApiObject, JsonPatch } from "cdk8s";

export const ROOT_UID = 0;
export const ROOT_GID = 0;

const commonEnv = {
  TZ: EnvValue.fromValue("America/Los_Angeles"),
};

export const commonProps: Partial<ContainerProps> = {
  envVariables: commonEnv,
  resources: {},
};

export function withCommonProps(props: ContainerProps): ContainerProps {
  return merge({}, commonProps, props);
}

export function setRevisionHistoryLimit(deployment: Deployment, limit = 3) {
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/revisionHistoryLimit", limit),
  );
}
