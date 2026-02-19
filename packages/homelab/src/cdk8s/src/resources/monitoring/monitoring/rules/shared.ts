import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

// Generic helper to escape Go template syntax so Helm doesn't process it
// Converts "{{ anything }}" to "{{ "{{" }} anything {{ "}}" }}"
export function escapeGoTemplate(template: string): string {
  // Use a more specific replacement to avoid double-escaping
  return template.replaceAll(/\{\{([^}]*)\}\}/g, '{{ "{{" }}$1{{ "}}" }}');
}

// Helper to create readable Prometheus template strings with Helm escaping
// Uses smart replacements for common Prometheus patterns, falls back to generic escaping
export function escapePrometheusTemplate(template: string): string {
  return template
    .replaceAll(
      /\{\{\s*\$value\s*\|\s*(\w+)\s*\}\}/g,
      '{{ "{{" }} $value | $1 {{ "}}" }}',
    ) // Handle {{ $value | filter }}
    .replaceAll(/\{\{\s*\$value\s*\}\}/g, '{{ "{{" }} $value {{ "}}" }}') // Handle {{ $value }}
    .replaceAll(
      /\{\{\s*\$labels\.(\w+)\s*\}\}/g,
      '{{ "{{" }} $labels.$1 {{ "}}" }}',
    ); // Handle {{ $labels.entity }}
}

// Alias for clarity when used in Alertmanager contexts
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
