import { describe, test, expect } from "bun:test";
import { parseYAMLComments, convertToTypeScriptInterface, generateTypeScriptCode } from "./helm-types";

describe("Integration Tests - Full Workflow", () => {
  test("should handle argo-cd rbac config end-to-end with */ escaping and prose extraction", () => {
    // Real-world test: simulate the full workflow from YAML to TypeScript
    const yaml = `configs:
  rbac:
    create: true
    annotations: {}

    # -- The name of the default role which Argo CD will falls back to, when authorizing API requests (optional).
    # If omitted or empty, users may be still be able to login, but will see no apps, projects, etc...
    policy.default: ''

    # -- File containing user-defined policies and role definitions.
    policy.csv: ''
    # Policy rules are in the form:
    #  p, subject, resource, action, object, effect
    # Role definitions and bindings are in the form:
    #  g, subject, inherited-subject
    # policy.csv: |
    #   p, role:org-admin, applications, *, */*, allow
    #   p, role:org-admin, clusters, get, *, allow
    #   p, role:org-admin, repositories, *, *, allow
    #   p, role:org-admin, logs, get, *, allow
    #   p, role:org-admin, exec, create, */*, allow
    #   g, your-github-org:your-team, role:org-admin

    # -- OIDC scopes to examine during rbac enforcement (in addition to \`sub\` scope).
    # The scope value can be a string, or a list of strings.
    scopes: "[groups]"

    # -- Matcher function for Casbin, \`glob\` for glob matcher and \`regex\` for regex matcher.
    policy.matchMode: "glob"`;

    // Step 1: Parse YAML structure (simulated with a simple object)
    const values = {
      configs: {
        rbac: {
          create: true,
          annotations: {},
          "policy.default": "",
          "policy.csv": "",
          scopes: "[groups]",
          "policy.matchMode": "glob",
        },
      },
    };

    // Step 2: Parse comments
    const comments = parseYAMLComments(yaml);

    // Step 3: Convert to TypeScript interface with comments
    const tsInterface = convertToTypeScriptInterface(values, "TestHelmValues", undefined, comments);

    // Step 4: Generate TypeScript code
    const code = generateTypeScriptCode(tsInterface, "test");

    // Verify structure is correct
    expect(code).toContain("export type TestHelmValues");
    expect(code).toContain("configs?:");
    expect(code).toContain("TestHelmValuesConfigs");

    // Verify comments were extracted
    expect(comments.get("configs.rbac.policy.default")).toBeDefined();
    expect(comments.get("configs.rbac.scopes")).toBeDefined();

    // Verify OIDC comment was extracted (not just policy rules)
    expect(comments.get("configs.rbac.scopes")).toContain("OIDC scopes");

    // Verify policy rules were filtered out (*/*)
    expect(comments.get("configs.rbac.scopes")).not.toContain("p, role:org-admin, applications");

    // Verify that if there were */ in comments, they would be escaped
    // In this case, the policy rules with */ were filtered out, so we test the escaping separately
    const testCodeWithStarSlash = generateTypeScriptCode(
      {
        name: "Test",
        properties: {
          test: {
            type: "string",
            optional: true,
            description: "Test with */",
          },
        },
      },
      "test",
    );
    expect(testCodeWithStarSlash).toContain("*\\/");

    // Verify the generated code is valid TypeScript by checking structure
    expect(code).toContain("scopes?: string;");
    expect(code).toContain('"policy.default"?: string;');
    expect(code).toContain('"policy.csv"?: string;');
    expect(code).toContain('"policy.matchMode"?: string;');

    // Verify no unescaped */ in comments (which would break TypeScript)
    const jsdocComments = code.match(/\/\*\*[\s\S]*?\*\//g) ?? [];
    for (const comment of jsdocComments) {
      // Count unescaped */ (not preceded by backslash)
      const unescapedMatches = comment.match(/[^\\]\*\//g);
      // Should only be 1 (the closing */)
      if (unescapedMatches) {
        expect(unescapedMatches.length).toBe(1);
      }
    }
  });

  test("should handle deeply nested structures with dotted keys", () => {
    const yaml = `server:
  ingress:
    # -- Comment for hostname
    ingress.hostname: "argocd.example.com"
    # -- Comment for tls.enabled
    tls.enabled: true`;

    const values = {
      server: {
        ingress: {
          "ingress.hostname": "argocd.example.com",
          "tls.enabled": true,
        },
      },
    };

    const comments = parseYAMLComments(yaml);
    const tsInterface = convertToTypeScriptInterface(values, "TestValues", undefined, comments);
    const code = generateTypeScriptCode(tsInterface, "test");

    // Verify dotted keys are handled
    expect(code).toContain('"ingress.hostname"?: string;');
    expect(code).toContain('"tls.enabled"?: boolean;');

    // Verify comments are associated correctly
    expect(comments.get("server.ingress.ingress.hostname")).toContain("Comment for hostname");
    expect(comments.get("server.ingress.tls.enabled")).toContain("Comment for tls.enabled");
  });

  test("should handle complex real-world Kubernetes manifests", () => {
    const yaml = `deployment:
  # -- Number of replicas
  replicas: 3

  # -- Container image
  image: nginx:1.21

  resources:
    # -- CPU and memory limits
    limits:
      cpu: "1000m"
      memory: "1Gi"
    requests:
      cpu: "100m"
      memory: "128Mi"

  # -- Environment variables
  env:
    - name: LOG_LEVEL
      value: info
    - name: PORT
      value: "8080"

  # -- Node selector with special keys
  nodeSelector:
    kubernetes.io/os: linux
    node.kubernetes.io/instance-type: t3.medium`;

    const values = {
      deployment: {
        replicas: 3,
        image: "nginx:1.21",
        resources: {
          limits: {
            cpu: "1000m",
            memory: "1Gi",
          },
          requests: {
            cpu: "100m",
            memory: "128Mi",
          },
        },
        env: [
          { name: "LOG_LEVEL", value: "info" },
          { name: "PORT", value: "8080" },
        ],
        nodeSelector: {
          "kubernetes.io/os": "linux",
          "node.kubernetes.io/instance-type": "t3.medium",
        },
      },
    };

    const comments = parseYAMLComments(yaml);
    const tsInterface = convertToTypeScriptInterface(values, "K8sManifestValues", undefined, comments);
    const code = generateTypeScriptCode(tsInterface, "k8s-manifest");

    // Verify structure
    expect(code).toContain("export type K8sManifestValues");
    expect(code).toContain("deployment?:");

    // Verify comments
    expect(comments.get("deployment.replicas")).toContain("Number of replicas");
    expect(comments.get("deployment.image")).toContain("Container image");
    expect(comments.get("deployment.resources.limits")).toContain("CPU and memory limits");

    // Verify array types
    expect(code).toContain("env?:");
    expect(code).toContain("Element[]");

    // Verify dotted keys in nodeSelector
    expect(code).toContain('"kubernetes.io/os"?: string;');
    expect(code).toContain('"node.kubernetes.io/instance-type"?: string;');
  });

  test("should preserve multi-paragraph documentation", () => {
    const yaml = `config:
  # -- This is the first paragraph explaining the feature.
  # It continues on multiple lines.
  #
  # This is a second paragraph with more details.
  # It also spans multiple lines.
  #
  # Finally, a third paragraph with examples:
  # - Example 1
  # - Example 2
  setting: "default"`;

    const values = {
      config: {
        setting: "default",
      },
    };

    const comments = parseYAMLComments(yaml);
    const tsInterface = convertToTypeScriptInterface(values, "DocValues", undefined, comments);
    const code = generateTypeScriptCode(tsInterface, "docs");

    // Verify multi-paragraph structure is preserved
    expect(comments.get("config.setting")).toContain("first paragraph");
    expect(comments.get("config.setting")).toContain("second paragraph");
    expect(comments.get("config.setting")).toContain("third paragraph");

    // Verify in generated code
    expect(code).toContain("This is the first paragraph");
    expect(code).toContain("This is a second paragraph");
    expect(code).toContain("Finally, a third paragraph");
  });
});
