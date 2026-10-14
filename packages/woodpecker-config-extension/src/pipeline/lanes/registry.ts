import { grant } from "#src/pipeline/lanes/tofu.ts";

/** Publisher and reader identities stay on separate release lanes. */
export const DOCKERHUB_PUBLISH = [
  grant("ci-dockerhub-publisher-credentials", "DOCKERHUB_USERNAME"),
  grant("ci-dockerhub-publisher-credentials", "DOCKERHUB_PUBLISH_TOKEN"),
] as const;

export const DOCKERHUB_READ = grant(
  "dockerhub-pull-woodpecker-ci",
  ".dockerconfigjson",
  "DOCKERHUB_READ_CONFIG_JSON",
);

export const DOCKERHUB_PUBLISH_LOGIN =
  "bun --no-install ci/scripts/reporting/dockerhub-env.ts";
export const DOCKERHUB_READ_LOGIN = `${DOCKERHUB_PUBLISH_LOGIN} --reader`;
