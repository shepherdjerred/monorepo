import { PrometheusRuleSpecGroupsRulesExpr } from "../../../../../generated/imports/monitoring.coreos.com";

// Generic helper to escape Go template syntax so Helm doesn't process it
// Converts "{{ anything }}" to "{{ "{{" }} anything {{ "}}" }}"
export function escapeGoTemplate(template: string): string {
  // Use a more specific replacement to avoid double-escaping
  return template.replace(/\{\{([^}]*)\}\}/g, '{{ "{{" }}$1{{ "}}" }}');
}

// Helper to create readable Prometheus template strings with Helm escaping
// Uses smart replacements for common Prometheus patterns, falls back to generic escaping
export function escapePrometheusTemplate(template: string): string {
  return template
    .replaceAll(/\{\{\s*\$value\s*\|\s*(\w+)\s*\}\}/g, '{{ "{{" }} $value | $1 {{ "}}" }}') // Handle {{ $value | filter }}
    .replaceAll(/\{\{\s*\$value\s*\}\}/g, '{{ "{{" }} $value {{ "}}" }}') // Handle {{ $value }}
    .replaceAll(/\{\{\s*\$labels\.(\w+)\s*\}\}/g, '{{ "{{" }} $labels.$1 {{ "}}" }}'); // Handle {{ $labels.entity }}
}

// Alias for clarity when used in Alertmanager contexts
export const escapeAlertmanagerTemplate = escapeGoTemplate;

// Rule factory functions for common alert patterns
export function createSensorAlert(
  name: string,
  entity: string,
  condition: string,
  threshold: string | number,
  description: string,
  summary: string,
  duration = "10m",
  severity = "warning",
) {
  return {
    alert: name,
    annotations: {
      description: escapePrometheusTemplate(description),
      summary,
    },
    expr: PrometheusRuleSpecGroupsRulesExpr.fromString(`${entity} ${condition} ${String(threshold)}`),
    for: duration,
    labels: { severity },
  };
}

export function createBinarySensorAlert(
  name: string,
  entity: string,
  description: string,
  summary: string,
  duration = "5m",
) {
  return createSensorAlert(
    name,
    `homeassistant_binary_sensor_state{entity="${entity}"}`,
    "==",
    1,
    description,
    summary,
    duration,
  );
}
