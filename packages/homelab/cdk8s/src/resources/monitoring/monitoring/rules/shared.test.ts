import { describe, test, expect } from "bun:test";
import { escapeGoTemplate, escapePrometheusTemplate, escapeAlertmanagerTemplate } from "./shared.ts";

describe("Template escaping utilities", () => {
  describe("escapeGoTemplate", () => {
    test("should escape simple Go templates", () => {
      const input = "{{ .Value }}";
      const expected = '{{ "{{" }} .Value {{ "}}" }}';
      expect(escapeGoTemplate(input)).toBe(expected);
    });

    test("should escape multiple templates in one string", () => {
      const input = "{{ .First }} and {{ .Second }}";
      const expected = '{{ "{{" }} .First {{ "}}" }} and {{ "{{" }} .Second {{ "}}" }}';
      expect(escapeGoTemplate(input)).toBe(expected);
    });

    test("should handle complex Alertmanager templates", () => {
      const input = "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ end }}";
      const expected =
        '{{ "{{" }} range .Alerts {{ "}}" }}{{ "{{" }} .Annotations.summary {{ "}}" }}\n{{ "{{" }} end {{ "}}" }}';
      expect(escapeGoTemplate(input)).toBe(expected);
    });

    test("should handle templates with pipes and functions", () => {
      const input = "{{ .Alerts.Firing | len }}";
      const expected = '{{ "{{" }} .Alerts.Firing | len {{ "}}" }}';
      expect(escapeGoTemplate(input)).toBe(expected);
    });

    test("should handle nested JSON with templates", () => {
      const input = '{\n  "count": "{{ .Alerts | len }}",\n  "status": "{{ .Status }}"\n}';
      const expected =
        '{\n  "count": "{{ "{{" }} .Alerts | len {{ "}}" }}",\n  "status": "{{ "{{" }} .Status {{ "}}" }}"\n}';
      expect(escapeGoTemplate(input)).toBe(expected);
    });

    test("should handle empty string", () => {
      expect(escapeGoTemplate("")).toBe("");
    });

    test("should handle strings without templates", () => {
      const input = "No templates here";
      expect(escapeGoTemplate(input)).toBe("No templates here");
    });
  });

  describe("escapePrometheusTemplate", () => {
    test("should escape $value template", () => {
      const input = "CPU usage is {{ $value }}%";
      const expected = 'CPU usage is {{ "{{" }} $value {{ "}}" }}%';
      expect(escapePrometheusTemplate(input)).toBe(expected);
    });

    test("should escape $value with filter", () => {
      const input = "Memory usage: {{ $value | humanize }} bytes";
      const expected = 'Memory usage: {{ "{{" }} $value | humanize {{ "}}" }} bytes';
      expect(escapePrometheusTemplate(input)).toBe(expected);
    });

    test("should escape $labels template", () => {
      const input = "Alert on {{ $labels.instance }}";
      const expected = 'Alert on {{ "{{" }} $labels.instance {{ "}}" }}';
      expect(escapePrometheusTemplate(input)).toBe(expected);
    });

    test("should handle multiple Prometheus patterns", () => {
      const input = "{{ $labels.job }} has {{ $value | humanizePercentage }} usage on {{ $labels.instance }}";
      const expected =
        '{{ "{{" }} $labels.job {{ "}}" }} has {{ "{{" }} $value | humanizePercentage {{ "}}" }} usage on {{ "{{" }} $labels.instance {{ "}}" }}';
      expect(escapePrometheusTemplate(input)).toBe(expected);
    });

    test("should handle whitespace variations", () => {
      const input = "{{$value}} and {{ $value }} and {{  $value  }}";
      const expected = '{{ "{{" }} $value {{ "}}" }} and {{ "{{" }} $value {{ "}}" }} and {{ "{{" }} $value {{ "}}" }}';
      expect(escapePrometheusTemplate(input)).toBe(expected);
    });

    test("should handle complex filter chains", () => {
      const input = "{{ $value | humanizePercentage }}";
      const expected = '{{ "{{" }} $value | humanizePercentage {{ "}}" }}';
      expect(escapePrometheusTemplate(input)).toBe(expected);
    });
  });

  describe("escapeAlertmanagerTemplate (alias)", () => {
    test("should be an alias for escapeGoTemplate", () => {
      expect(escapeAlertmanagerTemplate).toBe(escapeGoTemplate);
    });

    test("should work with Alertmanager-specific templates", () => {
      const input = "{{ range .Alerts.Firing }}{{ . }}\n{{ end }}";
      const expected = '{{ "{{" }} range .Alerts.Firing {{ "}}" }}{{ "{{" }} . {{ "}}" }}\n{{ "{{" }} end {{ "}}" }}';
      expect(escapeAlertmanagerTemplate(input)).toBe(expected);
    });
  });

  describe("Real-world examples", () => {
    test("should handle complex Alertmanager description", () => {
      const input = "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ end }}";
      const expected =
        '{{ "{{" }} range .Alerts {{ "}}" }}{{ "{{" }} .Annotations.summary {{ "}}" }}\n{{ "{{" }} end {{ "}}" }}';
      expect(escapeAlertmanagerTemplate(input)).toBe(expected);
    });

    test("should handle JSON details for PagerDuty", () => {
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

      // Should escape all the template syntax
      expect(result).toContain('{{ "{{" }} range .Alerts.Firing {{ "}}" }}');
      expect(result).toContain('{{ "{{" }} .Alerts.Firing | len {{ "}}" }}');
      expect(result).not.toContain("{{ range"); // Should not contain unescaped templates
    });

    test("should handle Prometheus alert description", () => {
      const input =
        "Node {{ $labels.instance }} has sustained high CPU usage: {{ $value | humanizePercentage }} for over 1 day";
      const expected =
        'Node {{ "{{" }} $labels.instance {{ "}}" }} has sustained high CPU usage: {{ "{{" }} $value | humanizePercentage {{ "}}" }} for over 1 day';
      expect(escapePrometheusTemplate(input)).toBe(expected);
    });
  });
});
