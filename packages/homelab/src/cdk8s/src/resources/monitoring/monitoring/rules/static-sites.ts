import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getStaticSitesRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "static-sites-availability",
      rules: [
        {
          alert: "StaticSiteDown",
          annotations: {
            summary: escapePrometheusTemplate(
              "Static site {{ $labels.site }}{{ $labels.path }} is unreachable",
            ),
            description: escapePrometheusTemplate(
              "HTTP health probes to static site {{ $labels.site }}{{ $labels.path }} ({{ $labels.endpoint }}) have failed for over 5 minutes, indicating visitors cannot load the page. Check static-site hosting pods, ingress routing, DNS/CDN status, and blackbox-exporter probe logs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'probe_success{job=~"static-site-.*"} == 0',
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "StaticSiteSlowResponse",
          annotations: {
            summary: escapePrometheusTemplate(
              "Static site {{ $labels.site }}{{ $labels.path }} is responding slowly",
            ),
            description: escapePrometheusTemplate(
              "Static site {{ $labels.site }}{{ $labels.path }} ({{ $labels.endpoint }}) has taken {{ $value | humanizeDuration }} (>3s) to respond for over 10 minutes, degrading page load times. Check probe phase durations (DNS, connect, TLS, processing) in Prometheus and inspect CDN or ingress latency.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum by (job, instance, site, endpoint, path) (probe_http_duration_seconds{job=~"static-site-.*", phase=~"resolve|connect|tls|processing|transfer"}) > 3',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "StaticSiteSSLCertExpiringSoon",
          annotations: {
            summary: escapePrometheusTemplate(
              "TLS certificate for {{ $labels.site }} expires in under 14 days",
            ),
            description: escapePrometheusTemplate(
              "The TLS certificate serving {{ $labels.site }} expires in {{ $value | humanize }} days. Check cert-manager Certificate and Order resources or CDN edge certificate renewal before it reaches critical expiry.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(probe_ssl_earliest_cert_expiry{job=~"static-site-.*", endpoint="root"} - time()) / 86400 < 14',
          ),
          for: "1h",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "StaticSiteSSLCertExpiryCritical",
          annotations: {
            summary: escapePrometheusTemplate(
              "TLS certificate for {{ $labels.site }} expires in under 3 days",
            ),
            description: escapePrometheusTemplate(
              "The TLS certificate serving {{ $labels.site }} expires in {{ $value | humanize }} days and will soon break HTTPS access for visitors. Inspect cert-manager renewal challenges, DNS/HTTP solver logs, or edge TLS configuration immediately.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(probe_ssl_earliest_cert_expiry{job=~"static-site-.*", endpoint="root"} - time()) / 86400 < 3',
          ),
          for: "1h",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "StaticSiteProbeAbsent",
          annotations: {
            summary: "Static site probes are not running",
            description:
              "Prometheus has collected no health probe metrics for any static site in the last 10 minutes, leaving static-site outages undetected. Check that prometheus-blackbox-exporter is running and inspect Probe resources and Prometheus scrape targets in the monitoring namespace.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'absent(probe_success{job=~"static-site-.*"}) == 1',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          // Suppress when StaticSiteProbeAbsent already fires for a total
          // blackbox outage — that alert is the superset condition and would
          // otherwise double-page on the same root cause.
          alert: "StaticSiteRssProbeAbsent",
          annotations: {
            summary: "sjer.red RSS probe is not running",
            description:
              "Prometheus has received no probe metrics for https://sjer.red/rss.xml over the last 10 minutes while other static-site probes are healthy, leaving RSS feed outages unmonitored. Check the static-site-sjer.red-rss Probe resource and its Prometheus scrape target.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'absent(probe_success{job="static-site-sjer.red-rss", site="sjer.red", endpoint="rss", path="/rss.xml"}) == 1 unless on() absent(probe_success{job=~"static-site-.*"}) == 1',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
