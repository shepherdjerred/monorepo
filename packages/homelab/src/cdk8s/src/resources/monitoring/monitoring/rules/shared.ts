import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

// CDK8s-generated PrometheusRule CRDs are embedded in the apps Helm chart,
// so Go template syntax ({{ $value }}, {{ $labels.xxx }}) must be escaped
// for Helm to pass them through literally to Prometheus/Alertmanager.
// Alertmanager config inside kube-prometheus-stack values is also Helm-rendered.
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
