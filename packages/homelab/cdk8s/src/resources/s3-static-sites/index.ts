import { Chart } from "cdk8s";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import { S3StaticSites } from "../../misc/s3-static-site.ts";
import { staticSites, S3_ENDPOINT, S3_CREDENTIALS_SECRET_NAME } from "./sites.ts";

export function createS3StaticSitesDeployment(chart: Chart) {
  new OnePasswordItem(chart, "s3-credentials", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/vet52jaeh75chsalu6lulugium",
    },
    metadata: {
      name: S3_CREDENTIALS_SECRET_NAME,
      namespace: chart.namespace,
    },
  });

  new S3StaticSites(chart, "s3-static-sites", {
    sites: staticSites,
    s3Endpoint: S3_ENDPOINT,
    credentialsSecretName: S3_CREDENTIALS_SECRET_NAME,
  });
}
