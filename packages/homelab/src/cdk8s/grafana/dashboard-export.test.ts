import { describe, expect, test } from "bun:test";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

describe("exportDashboardWithHelmEscaping", () => {
  test("should escape single Grafana template variable", () => {
    const dashboard = {
      title: "Test Dashboard",
      panels: [
        {
          legendFormat: "{{environment}}",
        },
      ],
    };

    const result = exportDashboardWithHelmEscaping(dashboard);

    // The legendFormat should now contain Helm-escaped syntax (not valid JSON, but a Helm template)
    expect(result).toContain('{{ print "{{" }}environment{{ print "}}" }}');
  });

  test("should escape multiple Grafana template variables", () => {
    const dashboard = {
      title: "Test Dashboard",
      panels: [
        {
          legendFormat: "{{environment}} - {{job_name}}",
        },
      ],
    };

    const result = exportDashboardWithHelmEscaping(dashboard);

    expect(result).toContain('{{ print "{{" }}environment{{ print "}}" }}');
    expect(result).toContain('{{ print "{{" }}job_name{{ print "}}" }}');
  });

  test("should handle nested objects with template variables", () => {
    const dashboard = {
      title: "Test Dashboard",
      templating: {
        list: [
          {
            name: "environment",
            query: "label_values({{metric}}, environment)",
          },
        ],
      },
    };

    const result = exportDashboardWithHelmEscaping(dashboard);

    expect(result).toContain('label_values({{ print "{{" }}metric{{ print "}}" }}, environment)');
  });

  test("should not modify non-template double braces in strings", () => {
    const dashboard = {
      title: "Test Dashboard",
      description: "This is a test with {{ but incomplete syntax",
    };

    const result = exportDashboardWithHelmEscaping(dashboard);

    // Incomplete template syntax should not be escaped
    expect(result).toContain("This is a test with {{ but incomplete syntax");
  });

  test("should handle empty dashboard", () => {
    const dashboard = {};

    const result = exportDashboardWithHelmEscaping(dashboard);

    expect(result).toBe("{}");
  });

  test("should handle dashboard without template variables", () => {
    const dashboard = {
      title: "Test Dashboard",
      panels: [
        {
          legendFormat: "Static Legend",
        },
      ],
    };

    const result = exportDashboardWithHelmEscaping(dashboard);

    expect(result).toContain('"legendFormat": "Static Legend"');
  });

  test("should pretty print by default", () => {
    const dashboard = {
      title: "Test",
    };

    const result = exportDashboardWithHelmEscaping(dashboard);

    // Pretty printed JSON should have newlines and indentation
    expect(result).toContain("\n");
    expect(result).toContain("  ");
  });

  test("should support compact output", () => {
    const dashboard = {
      title: "Test",
    };

    const result = exportDashboardWithHelmEscaping(dashboard, false);

    // Compact JSON should be on a single line (no indentation)
    expect(result).not.toContain("\n  ");
  });

  test("should escape variables in array values", () => {
    const dashboard = {
      panels: [
        {
          targets: [{ legendFormat: "{{instance}}" }, { legendFormat: "{{disk}} - {{device_model}}" }],
        },
      ],
    };

    const result = exportDashboardWithHelmEscaping(dashboard);

    expect(result).toContain('{{ print "{{" }}instance{{ print "}}" }}');
    expect(result).toContain('{{ print "{{" }}disk{{ print "}}" }}');
    expect(result).toContain('{{ print "{{" }}device_model{{ print "}}" }}');
  });

  test("should handle complex dashboard structure", () => {
    const dashboard = {
      title: "Complex Dashboard",
      uid: "test-dashboard",
      tags: ["test"],
      templating: {
        list: [
          {
            name: "env",
            label: "Environment",
            query: "label_values(metric, env)",
          },
        ],
      },
      panels: [
        {
          id: 1,
          title: "Panel 1",
          targets: [
            {
              expr: 'rate(requests_total{env="{{env}}"}[5m])',
              legendFormat: "{{env}} - {{status}}",
            },
          ],
        },
        {
          id: 2,
          title: "Panel 2",
          targets: [
            {
              expr: "up",
              legendFormat: "Static",
            },
          ],
        },
      ],
    };

    const result = exportDashboardWithHelmEscaping(dashboard);

    // Check that template variables are escaped
    expect(result).toContain('rate(requests_total{env=\\"{{ print "{{" }}env{{ print "}}" }}\\"}[5m])');
    expect(result).toContain('{{ print "{{" }}env{{ print "}}" }}');
    expect(result).toContain('{{ print "{{" }}status{{ print "}}" }}');

    // Check that non-template content is preserved
    expect(result).toContain('"title": "Complex Dashboard"');
    expect(result).toContain('"legendFormat": "Static"');
  });
});
