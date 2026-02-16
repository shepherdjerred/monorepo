import { merge } from "lodash";
import { ContainerProps, EnvValue } from "cdk8s-plus-31";

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
