/**
 * Utility for exporting Grafana dashboards as JSON with Helm template variable escaping
 *
 * This module provides a generic function to convert dashboard objects to JSON strings
 * while properly escaping Grafana template variables ({{variable}}) for Helm compatibility.
 *
 * The challenge: When dashboards are JSON-stringified, the curly braces in {{variable}}
 * get escaped as part of the JSON string. Since these are embedded in YAML ConfigMaps,
 * Helm would then try to process them. We need to escape them for Helm using:
 * {{ print "{{" }}variable{{ print "}}" }}
 *
 * This allows us to use standard Grafana {{variable}} syntax in TypeScript code
 * while ensuring proper Helm escaping in the final YAML output.
 */

/**
 * Converts a dashboard object to JSON string with Helm-escaped Grafana template variables
 *
 * This function:
 * 1. Stringifies the dashboard object to JSON
 * 2. Parses it back to traverse and find Grafana template variables ({{...}})
 * 3. Replaces them with Helm-escaped syntax: {{ print "{{" }}var{{ print "}}" }}
 * 4. Returns the final JSON string
 *
 * @param dashboard - The dashboard object to export (typically from DashboardBuilder.build())
 * @param prettyPrint - Whether to format the JSON with indentation (default: true)
 * @returns JSON string with Helm-escaped Grafana template variables
 *
 * @example
 * ```typescript
 * const dashboard = new DashboardBuilder("My Dashboard")
 *   .withPanel(
 *     new PanelBuilder()
 *       .legendFormat("{{environment}}")
 *   )
 *   .build();
 *
 * const json = exportDashboardWithHelmEscaping(dashboard);
 * // Result contains: {{ print "{{" }}environment{{ print "}}" }}
 * ```
 */
export function exportDashboardWithHelmEscaping(dashboard: unknown, prettyPrint = true): string {
  // First, stringify the dashboard to JSON
  const jsonString = JSON.stringify(dashboard, null, prettyPrint ? 2 : undefined);

  // Replace all occurrences of {{variable}} with Helm-escaped syntax
  // This regex matches:
  // - {{ followed by
  // - any word characters (variable name)
  // - followed by }}
  // The \b ensures we match word boundaries
  const templateVarRegex = /\{\{(\w+)\}\}/g;

  const escapedJson = jsonString.replace(templateVarRegex, (_match, variableName: string) => {
    // Create Helm-escaped syntax: {{ print "{{" }}variable{{ print "}}" }}
    return `{{ print "{{" }}${variableName}{{ print "}}" }}`;
  });

  return escapedJson;
}

/**
 * Type alias for dashboard objects (from Grafana Foundation SDK)
 * This provides better type safety for the export function
 */
export type GrafanaDashboard = Record<string, unknown>;
