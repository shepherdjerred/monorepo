import { Chart, Duration } from "cdk8s";
import { ConfigMap, Deployment, EnvValue, Probe, Secret, Service, Volume } from "cdk8s-plus-31";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import versions from "../../versions.ts";
import { createServiceMonitor } from "../../misc/service-monitor.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";

const CURRENT_FILENAME = fileURLToPath(import.meta.url);
const CURRENT_DIRNAME = dirname(CURRENT_FILENAME);

export async function createR2ExporterMonitoring(chart: Chart) {
  // Load the exporter script content from file
  const scriptPath = join(CURRENT_DIRNAME, "scripts", "r2_exporter.py");
  let scriptContent = await Bun.file(scriptPath).text();

  // Escape double curly braces for Helm compatibility
  // Python f-strings use {{ and }} for literal braces, but Helm interprets these as template delimiters
  // Use placeholders to avoid double-replacement issues
  scriptContent = scriptContent
    .replace(/\{\{/g, "__HELM_OPEN__")
    .replace(/\}\}/g, "__HELM_CLOSE__")
    .replace(/__HELM_OPEN__/g, '{{ "{{" }}')
    .replace(/__HELM_CLOSE__/g, '{{ "}}" }}');

  // Create 1Password secret for Cloudflare API credentials
  const cloudflareSecret = new OnePasswordItem(chart, "r2-exporter-cloudflare-secret", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/faryqlpsnrqupkirkwrejct3iy",
    },
    metadata: {
      name: "r2-exporter-cloudflare",
      namespace: "prometheus",
    },
  });

  // Create ConfigMap with the exporter script
  const r2ExporterScript = new ConfigMap(chart, "r2-exporter-script", {
    metadata: {
      name: "r2-exporter-script",
      namespace: "prometheus",
    },
    data: {
      "r2_exporter.py": scriptContent,
    },
  });

  // Create Deployment for the R2 exporter
  const deployment = new Deployment(chart, "r2-exporter", {
    metadata: {
      name: "r2-exporter",
      namespace: "prometheus",
      labels: {
        app: "r2-exporter",
      },
    },
    replicas: 1,
  });

  // Configure the container
  const container = deployment.addContainer({
    name: "r2-exporter",
    image: `docker.io/library/python:${versions["library/python"]}`,
    command: ["python3"],
    args: ["/scripts/r2_exporter.py"],
    ports: [{ number: 9199, name: "metrics" }],
    envVariables: {
      CLOUDFLARE_API_TOKEN: EnvValue.fromSecretValue({
        secret: Secret.fromSecretName(chart, "r2-exporter-secret-ref", cloudflareSecret.name),
        key: "api_token",
      }),
      CLOUDFLARE_ACCOUNT_ID: EnvValue.fromSecretValue({
        secret: Secret.fromSecretName(chart, "r2-exporter-account-ref", cloudflareSecret.name),
        key: "account_id",
      }),
      R2_BUCKET_NAME: EnvValue.fromValue("homelab"),
      SCRAPE_INTERVAL_SECONDS: EnvValue.fromValue("300"),
      EXPORTER_PORT: EnvValue.fromValue("9199"),
    },
    liveness: Probe.fromHttpGet("/healthz", {
      port: 9199,
      initialDelaySeconds: Duration.seconds(10),
      periodSeconds: Duration.seconds(30),
      failureThreshold: 3,
    }),
    readiness: Probe.fromHttpGet("/healthz", {
      port: 9199,
      initialDelaySeconds: Duration.seconds(5),
      periodSeconds: Duration.seconds(10),
    }),
    securityContext: {
      ensureNonRoot: true,
      readOnlyRootFilesystem: true,
      user: 65534, // nobody user
      group: 65534,
    },
  });

  // Mount the script from ConfigMap
  const scriptVolume = Volume.fromConfigMap(chart, "r2-exporter-script-volume", r2ExporterScript);
  deployment.addVolume(scriptVolume);
  container.mount("/scripts", scriptVolume, { readOnly: true });

  // Create Service for the exporter
  new Service(chart, "r2-exporter-service", {
    metadata: {
      name: "r2-exporter",
      namespace: "prometheus",
      labels: {
        app: "r2-exporter",
      },
    },
    selector: deployment,
    ports: [{ port: 9199, name: "metrics" }],
  });

  // Create ServiceMonitor for Prometheus to scrape R2 metrics
  createServiceMonitor(chart, {
    name: "r2-exporter",
    metadataName: "r2-exporter",
    namespace: "prometheus",
    interval: "60s",
  });

  return { cloudflareSecret, r2ExporterScript, deployment };
}
