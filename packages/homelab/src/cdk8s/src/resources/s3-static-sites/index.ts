import type { Chart } from "cdk8s";
import { mailPolicyHosts } from "homelab/src/domain-registry.ts";
import { S3StaticSites } from "@shepherdjerred/homelab/cdk8s/src/misc/s3-static-site.ts";
import {
  staticSites,
  S3_ENDPOINT,
  S3_CREDENTIALS_SECRET_NAME,
} from "./sites.ts";
import { seaweedfsS3 } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

export function createS3StaticSitesDeployment(chart: Chart) {
  seaweedfsS3.item(chart, "s3-credentials", S3_CREDENTIALS_SECRET_NAME);

  new S3StaticSites(chart, "s3-static-sites", {
    sites: staticSites,
    mailPolicies: mailPolicyHosts,
    s3Endpoint: S3_ENDPOINT,
    credentialsSecretName: S3_CREDENTIALS_SECRET_NAME,
  });
}
