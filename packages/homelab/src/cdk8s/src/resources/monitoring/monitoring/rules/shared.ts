import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

/**
 * Helm Go template escaping utilities.
 *
 * CDK8s-generated YAML goes through Helm's Go template engine before reaching K8s.
 * Any {{ in the YAML is interpreted as Go template syntax. Content that needs literal
 * {{ in the final K8s resource must be escaped as {{ "{{" }} so Helm passes it through.
 *
 * Four content categories need escaping:
 * 1. Prometheus/Alertmanager rule annotations → escapePrometheusTemplate()
 * 2. Event-exporter/Go template configs → escapeHelmGoTemplate()
 * 3. Home Assistant Jinja2 → pre-escaped in source YAML files
 * 4. Embedded scripts with {{ (e.g. Python f-strings) → manual .replaceAll()
 *
 * See: packages/docs/guides/2026-04-04_helm-escaping-pipeline.md
 */
export function escapeGoTemplate(template: string): string {
  return template;
}

// Escapes Go template syntax for content that goes through Helm templating.
// Converts {{ X }} to {{ "{{" }} X {{ "}}" }} so Helm passes them through literally.
export function escapeHelmGoTemplate(template: string): string {
  return template.replaceAll(/\{\{(.*?)\}\}/g, '{{ "{{" }}$1{{ "}}" }}');
}

export function escapePrometheusTemplate(template: string): string {
  return escapeHelmGoTemplate(template);
}

export const escapeAlertmanagerTemplate = escapeGoTemplate;

// Rule factory functions for common alert patterns
export function createSensorAlert(options: {
  name: string;
  entity: string;
  condition: string;
  threshold: string | number;
  description: string;
  summary: string;
  duration?: string;
  severity?: string;
}) {
  const duration = options.duration ?? "10m";
  const severity = options.severity ?? "warning";
  return {
    alert: options.name,
    annotations: {
      description: escapePrometheusTemplate(options.description),
      summary: options.summary,
    },
    expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
      `${options.entity} ${options.condition} ${String(options.threshold)}`,
    ),
    for: duration,
    labels: { severity },
  };
}

export function createBinarySensorAlert(options: {
  name: string;
  entity: string;
  description: string;
  summary: string;
  duration?: string;
}) {
  return createSensorAlert({
    name: options.name,
    entity: `homeassistant_binary_sensor_state{entity="${options.entity}"}`,
    condition: "==",
    threshold: 1,
    description: options.description,
    summary: options.summary,
    duration: options.duration ?? "5m",
  });
}
