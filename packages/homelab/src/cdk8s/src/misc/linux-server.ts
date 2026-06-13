import type { ContainerProps } from "cdk8s-plus-31";
import { EnvValue } from "cdk8s-plus-31";
import { commonProps, ROOT_GID, ROOT_UID } from "./common.ts";
import { merge } from "lodash";

export const LINUXSERVER_UID = 1000;
export const LINUXSERVER_GID = 1000;

/**
 * kube-linter annotations for LinuxServer.io images.
 * These images run as root internally and require a writable filesystem.
 */
export const LINUXSERVER_KUBE_LINTER_ANNOTATIONS = {
  "ignore-check.kube-linter.io/run-as-non-root":
    "LinuxServer.io images run as root internally",
  "ignore-check.kube-linter.io/no-read-only-root-fs":
    "LinuxServer.io images require writable filesystem",
} as const;

const commonLinuxServerProps: Partial<ContainerProps> = {
  ...commonProps,
  envVariables: {
    ...commonProps.envVariables,
    // these variables are used by linuxserver.io images to change volume permissions on startup
    PUID: EnvValue.fromValue(LINUXSERVER_UID.toString()),
    PGID: EnvValue.fromValue(LINUXSERVER_GID.toString()),
  },
  securityContext: {
    // linuxserver.io images initially run as root, and require a writable filesystem
    ensureNonRoot: false,
    readOnlyRootFilesystem: false,
    user: ROOT_UID,
    group: ROOT_GID,
  },
};

/**
 * Merge LinuxServer.io-specific container props with caller-supplied props.
 *
 * NOTE: This function name (`withCommonLinuxServerProps`) is registered in the
 * `PROPS_WRAPPERS` set in `packages/eslint-config/src/rules/require-container-resources.ts`.
 * If you rename this function or add a new wrapper, update that set too so the
 * ESLint rule can look through the wrapper to find the props literal.
 */
export function withCommonLinuxServerProps(
  props: ContainerProps,
): ContainerProps {
  return merge({}, commonLinuxServerProps, props);
}
