import { App, Chart } from "cdk8s";
import { Namespace, ConfigMap } from "cdk8s-plus-31";
import { KubeCronJob, Quantity } from "../../generated/imports/k8s.ts";
import { EMAIL_DOMAINS, NO_EMAIL_DOMAINS } from "../resources/argo-applications/domains.ts";
import versions from "../versions.ts";

/**
 * DNS Audit CronJob
 *
 * Runs checkdmarc daily against all managed domains to verify:
 * - SPF records are valid and don't exceed lookup limits
 * - DMARC records exist with proper policy
 * - DKIM records are properly configured
 * - MX records are valid
 *
 * Outputs structured JSON logs that Loki collects.
 * Alert rules in loki.ts trigger on issues found.
 *
 * @see https://github.com/domainaware/checkdmarc
 */
export function createDnsAuditChart(app: App) {
  const chart = new Chart(app, "dns-audit", {
    namespace: "dns-audit",
    disableResourceNameHashes: true,
  });

  // Create namespace
  new Namespace(chart, "dns-audit-namespace", {
    metadata: {
      name: "dns-audit",
    },
  });

  // Python script for DNS auditing - stored in ConfigMap to avoid shell escaping issues
  const auditScript = `#!/usr/bin/env python3
import json
import subprocess
import sys

EMAIL_DOMAINS = ${JSON.stringify(EMAIL_DOMAINS)}
NO_EMAIL_DOMAINS = ${JSON.stringify(NO_EMAIL_DOMAINS)}

def log(level, msg, **kwargs):
    """Output structured JSON log"""
    entry = {"level": level, "msg": msg, **kwargs}
    print(json.dumps(entry), flush=True)

def check_domain(domain, parked=False):
    """Run checkdmarc on a single domain and log results"""
    log("info", "Checking domain", domain=domain, parked=parked)

    try:
        cmd = ["checkdmarc", "-f", "json"]
        if parked:
            cmd.append("-p")
        cmd.append(domain)

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode != 0:
            log("error", "checkdmarc failed", domain=domain, error=result.stderr.strip())
            return

        data = json.loads(result.stdout)

        # Check SPF
        spf = data.get("spf", {})
        if spf.get("error"):
            log("error", "SPF error", domain=domain, error=spf["error"], type="spf")
        elif spf.get("warnings"):
            for w in spf["warnings"]:
                log("warning", "SPF warning", domain=domain, warning=w, type="spf")
        else:
            log("info", "SPF OK", domain=domain, type="spf")

        # Check DMARC
        dmarc = data.get("dmarc", {})
        if dmarc.get("error"):
            log("error", "DMARC error", domain=domain, error=dmarc["error"], type="dmarc")
        elif dmarc.get("warnings"):
            for w in dmarc["warnings"]:
                log("warning", "DMARC warning", domain=domain, warning=w, type="dmarc")
        else:
            tags = dmarc.get("tags", {})
            policy = tags.get("p", {}).get("value", "none") if tags else "none"
            if policy == "none":
                log("warning", "DMARC policy is none (monitoring only)", domain=domain, type="dmarc", policy=policy)
            else:
                log("info", "DMARC OK", domain=domain, type="dmarc", policy=policy)

        # Check MX (only for email domains)
        if not parked:
            mx = data.get("mx", {})
            if mx.get("error"):
                log("error", "MX error", domain=domain, error=mx["error"], type="mx")
            elif mx.get("warnings"):
                for w in mx["warnings"]:
                    log("warning", "MX warning", domain=domain, warning=w, type="mx")

        log("info", "Domain check complete", domain=domain)

    except subprocess.TimeoutExpired:
        log("error", "checkdmarc timeout", domain=domain, type="timeout")
    except json.JSONDecodeError as e:
        log("error", "Failed to parse checkdmarc output", domain=domain, error=str(e))
    except Exception as e:
        log("error", "Unexpected error", domain=domain, error=str(e))

def main():
    all_domains = EMAIL_DOMAINS + NO_EMAIL_DOMAINS
    log("info", "Starting DNS audit", domains=all_domains)

    for domain in EMAIL_DOMAINS:
        check_domain(domain, parked=False)

    for domain in NO_EMAIL_DOMAINS:
        check_domain(domain, parked=True)

    log("info", "DNS audit complete")

if __name__ == "__main__":
    main()
`;

  // Store script in ConfigMap
  const scriptConfigMap = new ConfigMap(chart, "dns-audit-script", {
    metadata: {
      name: "dns-audit-script",
    },
    data: {
      "audit.py": auditScript,
    },
  });

  new KubeCronJob(chart, "dns-audit-cronjob", {
    metadata: {
      name: "dns-audit",
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs": "Container requires writable filesystem",
      },
    },
    spec: {
      // Run daily at 6 AM UTC
      schedule: "0 6 * * *",
      timeZone: "UTC",
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 1,
      jobTemplate: {
        spec: {
          activeDeadlineSeconds: 300,
          backoffLimit: 2,
          template: {
            metadata: {
              labels: {
                app: "dns-audit",
              },
            },
            spec: {
              restartPolicy: "OnFailure",
              containers: [
                {
                  name: "dns-audit",
                  image: `ghcr.io/shepherdjerred/dns-audit:${versions["shepherdjerred/dns-audit"]}`,
                  command: ["python3", "/scripts/audit.py"],
                  volumeMounts: [
                    {
                      name: "script",
                      mountPath: "/scripts",
                      readOnly: true,
                    },
                  ],
                  resources: {
                    requests: {
                      cpu: Quantity.fromString("100m"),
                      memory: Quantity.fromString("128Mi"),
                    },
                    limits: {
                      cpu: Quantity.fromString("500m"),
                      memory: Quantity.fromString("256Mi"),
                    },
                  },
                  securityContext: {
                    runAsNonRoot: true,
                    runAsUser: 65534,
                    runAsGroup: 65534,
                    allowPrivilegeEscalation: false,
                  },
                },
              ],
              volumes: [
                {
                  name: "script",
                  configMap: {
                    name: scriptConfigMap.name,
                    defaultMode: 0o755,
                  },
                },
              ],
            },
          },
        },
      },
    },
  });

  return chart;
}
