import { describe, test, expect } from "bun:test";
import {
  escapeGoTemplate,
  escapePrometheusTemplate,
  escapeAlertmanagerTemplate,
  escapeHelmGoTemplate,
} from "./shared.ts";

describe("Template escaping utilities", () => {
  describe("escapeGoTemplate (identity)", () => {
    test("should pass through simple Go templates unchanged", () => {
      const input = "{{ .Value }}";
      expect(escapeGoTemplate(input)).toBe(input);
    });

    test("should pass through multiple templates unchanged", () => {
      const input = "{{ .First }} and {{ .Second }}";
      expect(escapeGoTemplate(input)).toBe(input);
    });

    test("should pass through Alertmanager templates unchanged", () => {
      const input = "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ end }}";
      expect(escapeGoTemplate(input)).toBe(input);
    });

    test("should pass through templates with pipes unchanged", () => {
      const input = "{{ .Alerts.Firing | len }}";
      expect(escapeGoTemplate(input)).toBe(input);
    });

    test("should pass through nested JSON with templates unchanged", () => {
      const input =
        '{\n  "count": "{{ .Alerts | len }}",\n  "status": "{{ .Status }}"\n}';
      expect(escapeGoTemplate(input)).toBe(input);
    });

    test("should handle empty string", () => {
      expect(escapeGoTemplate("")).toBe("");
    });

    test("should handle strings without templates", () => {
      const input = "No templates here";
      expect(escapeGoTemplate(input)).toBe("No templates here");
    });
  });

  describe("escapeHelmGoTemplate", () => {
    test("should escape simple Go templates for Helm", () => {
      const input = "{{ .Value }}";
      const expected = '{{ "{{" }} .Value {{ "}}" }}';
      expect(escapeHelmGoTemplate(input)).toBe(expected);
    });

    test("should escape multiple templates", () => {
      const input = "{{ .First }} and {{ .Second }}";
      const expected =
        '{{ "{{" }} .First {{ "}}" }} and {{ "{{" }} .Second {{ "}}" }}';
      expect(escapeHelmGoTemplate(input)).toBe(expected);
    });

    test("should escape Alertmanager templates", () => {
      const input = "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ end }}";
      const expected =
        '{{ "{{" }} range .Alerts {{ "}}" }}{{ "{{" }} .Annotations.summary {{ "}}" }}\n{{ "{{" }} end {{ "}}" }}';
      expect(escapeHelmGoTemplate(input)).toBe(expected);
    });

    test("should escape templates with pipes", () => {
      const input = "{{ .Alerts.Firing | len }}";
      const expected = '{{ "{{" }} .Alerts.Firing | len {{ "}}" }}';
      expect(escapeHelmGoTemplate(input)).toBe(expected);
    });

    test("should handle empty string", () => {
      expect(escapeHelmGoTemplate("")).toBe("");
    });

    test("should handle strings without templates", () => {
      expect(escapeHelmGoTemplate("No templates here")).toBe(
        "No templates here",
      );
    });
  });

  describe("escapePrometheusTemplate (identity)", () => {
    test("should pass through $value template unchanged", () => {
      const input = "CPU usage is {{ $value }}%";
      expect(escapePrometheusTemplate(input)).toBe(input);
    });

    test("should pass through $value with filter unchanged", () => {
      const input = "Memory usage: {{ $value | humanize }} bytes";
      expect(escapePrometheusTemplate(input)).toBe(input);
    });

    test("should pass through $labels template unchanged", () => {
      const input = "Alert on {{ $labels.instance }}";
      expect(escapePrometheusTemplate(input)).toBe(input);
    });

    test("should pass through multiple Prometheus patterns unchanged", () => {
      const input =
        "{{ $labels.job }} has {{ $value | humanizePercentage }} usage on {{ $labels.instance }}";
      expect(escapePrometheusTemplate(input)).toBe(input);
    });

    test("should handle whitespace variations", () => {
      const input = "{{$value}} and {{ $value }} and {{  $value  }}";
      expect(escapePrometheusTemplate(input)).toBe(input);
    });

    test("should pass through complex filter chains unchanged", () => {
      const input = "{{ $value | humanizePercentage }}";
      expect(escapePrometheusTemplate(input)).toBe(input);
    });
  });

  describe("escapeAlertmanagerTemplate (alias)", () => {
    test("should be an alias for escapeGoTemplate", () => {
      expect(escapeAlertmanagerTemplate).toBe(escapeGoTemplate);
    });

    test("should pass through Alertmanager-specific templates unchanged", () => {
      const input = "{{ range .Alerts.Firing }}{{ . }}\n{{ end }}";
      expect(escapeAlertmanagerTemplate(input)).toBe(input);
    });
  });

  describe("Real-world examples", () => {
    test("should pass through complex Alertmanager description unchanged", () => {
      const input = "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ end }}";
      expect(escapeAlertmanagerTemplate(input)).toBe(input);
    });

    test("should pass through JSON details for PagerDuty unchanged", () => {
      const jsonTemplate = JSON.stringify(
        {
          firing: "{{ range .Alerts.Firing }}{{ . }}\n{{ end }}",
          resolved: "{{ range .Alerts.Resolved }}{{ . }}\n{{ end }}",
          num_firing: "{{ .Alerts.Firing | len }}",
          num_resolved: "{{ .Alerts.Resolved | len }}",
        },
        null,
        2,
      );

      const result = escapeGoTemplate(jsonTemplate);

      // Identity function — templates should be unchanged
      expect(result).toBe(jsonTemplate);
      expect(result).toContain("{{ range .Alerts.Firing }}");
      expect(result).toContain("{{ .Alerts.Firing | len }}");
    });

    test("should pass through Prometheus alert description unchanged", () => {
      const input =
        "Node {{ $labels.instance }} has sustained high CPU usage: {{ $value | humanizePercentage }} for over 1 day";
      expect(escapePrometheusTemplate(input)).toBe(input);
    });

    test("escapeHelmGoTemplate should escape real-world JSON details", () => {
      const jsonTemplate = JSON.stringify(
        {
          firing: "{{ range .Alerts.Firing }}{{ . }}\n{{ end }}",
          num_firing: "{{ .Alerts.Firing | len }}",
        },
        null,
        2,
      );

      const result = escapeHelmGoTemplate(jsonTemplate);
      expect(result).toContain('{{ "{{" }} range .Alerts.Firing {{ "}}" }}');
      expect(result).toContain('{{ "{{" }} .Alerts.Firing | len {{ "}}" }}');
      expect(result).not.toContain("{{ range");
    });
  });
});
