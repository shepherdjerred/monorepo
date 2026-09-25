import { WOODPECKER_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

/** Port the configuration extension serves on. */
export const CONFIG_EXTENSION_PORT = 3000;

/** Label selector shared by the extension Deployment and Service. */
export const CONFIG_EXTENSION_APP_LABEL = "woodpecker-config-extension";

/**
 * Endpoint the Woodpecker server calls to generate each build's pipeline.
 *
 * Woodpecker posts the repository, the pipeline, and the changed file list
 * here and uses the returned workflow YAML instead of anything committed in
 * the repository. That is what replaces Woodpecker's `pipeline upload`: the
 * lane selectors run in this service rather than in a bootstrap pod, so no
 * step has to start before the graph is known.
 *
 * Requests are signed with Woodpecker's ed25519 key and MUST be verified by
 * the extension — the payload carries repository credentials, and the response
 * is executed as a pipeline.
 *
 * The workload itself lands with the extension service; only the address is
 * defined here so the server can be configured to point at it.
 */
export const CONFIG_EXTENSION_ENDPOINT = `http://${CONFIG_EXTENSION_APP_LABEL}.${WOODPECKER_NAMESPACE}.svc.cluster.local:${CONFIG_EXTENSION_PORT.toString()}/ciconfig`;
