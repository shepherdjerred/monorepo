import { describe, test, expect } from "bun:test";
import { convertToTypeScriptInterface, generateTypeScriptCode } from "./helm-types";

describe("Snapshot Tests", () => {
  test("should generate consistent output for basic types with comments", () => {
    const values = {
      enabled: true,
      replicas: 3,
      image: "nginx:latest",
    };

    const comments = new Map([
      ["enabled", "Enable the deployment"],
      ["replicas", "Number of replicas to run"],
      ["image", "Container image to use"],
    ]);

    const tsInterface = convertToTypeScriptInterface(values, "BasicHelmValues", undefined, comments);
    const code = generateTypeScriptCode(tsInterface, "basic");

    expect(code).toMatchSnapshot();
  });

  test("should generate consistent output for dotted keys", () => {
    const values = {
      "policy.default": "role:readonly",
      "policy.csv": "",
      "ingress.enabled": true,
      "ingress.hostname": "example.com",
    };

    const comments = new Map([
      ["policy.default", "Default policy role"],
      ["policy.csv", "CSV policy definitions"],
      ["ingress.enabled", "Enable ingress"],
      ["ingress.hostname", "Ingress hostname"],
    ]);

    const tsInterface = convertToTypeScriptInterface(values, "DottedKeysHelmValues", undefined, comments);
    const code = generateTypeScriptCode(tsInterface, "dotted-keys");

    expect(code).toMatchSnapshot();
  });

  test("should generate consistent output with escaped */ sequences", () => {
    const values = {
      policy: "allow",
      rules: "",
    };

    const comments = new Map([
      [
        "policy",
        "Policy rules in the form: p, subject, resource, action, object, effect\nExample: p, role:admin, applications, *, */*, allow",
      ],
      ["rules", "Glob patterns: */*.js, */test/*, and */*/*.ts should match"],
    ]);

    const tsInterface = convertToTypeScriptInterface(values, "EscapedHelmValues", undefined, comments);
    const code = generateTypeScriptCode(tsInterface, "escaped");

    expect(code).toMatchSnapshot();
  });

  test("should generate consistent output for nested structures", () => {
    const values = {
      server: {
        replicas: 2,
        service: {
          type: "ClusterIP",
          port: 80,
        },
      },
      ingress: {
        enabled: false,
        hosts: ["example.com"],
      },
    };

    const comments = new Map([
      ["server", "Server configuration"],
      ["server.replicas", "Number of server replicas"],
      ["server.service", "Service configuration"],
      ["server.service.type", "Kubernetes service type"],
      ["server.service.port", "Service port number"],
      ["ingress", "Ingress configuration"],
      ["ingress.enabled", "Enable ingress controller"],
      ["ingress.hosts", "List of ingress hostnames"],
    ]);

    const tsInterface = convertToTypeScriptInterface(values, "NestedHelmValues", undefined, comments);
    const code = generateTypeScriptCode(tsInterface, "nested");

    expect(code).toMatchSnapshot();
  });

  test("should generate consistent output for argo-cd rbac configuration", () => {
    const values = {
      rbac: {
        create: true,
        annotations: {},
        "policy.default": "",
        "policy.csv": "",
        scopes: "[groups]",
        "policy.matchMode": "glob",
      },
    };

    const comments = new Map([
      ["rbac", "RBAC configuration for Argo CD"],
      ["rbac.create", "Create RBAC resources"],
      ["rbac.annotations", "Annotations for RBAC resources"],
      [
        "rbac.policy.default",
        "The name of the default role which Argo CD will falls back to, when authorizing API requests (optional).\nIf omitted or empty, users may be still be able to login, but will see no apps, projects, etc...",
      ],
      ["rbac.policy.csv", "File containing user-defined policies and role definitions."],
      [
        "rbac.scopes",
        "Policy rules are in the form:\nRole definitions and bindings are in the form:\nOIDC scopes to examine during rbac enforcement (in addition to `sub` scope).\nThe scope value can be a string, or a list of strings.",
      ],
      ["rbac.policy.matchMode", "Matcher function for Casbin, `glob` for glob matcher and `regex` for regex matcher."],
    ]);

    const tsInterface = convertToTypeScriptInterface(values, "ArgocdRbacHelmValues", undefined, comments);
    const code = generateTypeScriptCode(tsInterface, "argocd-rbac");

    expect(code).toMatchSnapshot();
  });

  test("should generate consistent output for arrays and objects", () => {
    const values = {
      tolerations: [
        {
          key: "node-role",
          operator: "Equal",
          value: "worker",
          effect: "NoSchedule",
        },
      ],
      nodeSelector: {
        "kubernetes.io/os": "linux",
      },
      env: [
        {
          name: "LOG_LEVEL",
          value: "info",
        },
      ],
    };

    const comments = new Map([
      ["tolerations", "Pod tolerations for node taints"],
      ["nodeSelector", "Node selector labels"],
      ["env", "Environment variables"],
    ]);

    const tsInterface = convertToTypeScriptInterface(values, "ComplexTypesHelmValues", undefined, comments);
    const code = generateTypeScriptCode(tsInterface, "complex-types");

    expect(code).toMatchSnapshot();
  });

  test("should generate consistent output with special characters in comments", () => {
    const values = {
      config: "default",
      pattern: "*.js",
    };

    const comments = new Map([
      [
        "config",
        "Configuration with special chars: `backticks`, (parentheses), [brackets], {braces}, <angles>, \"quotes\", and 'apostrophes'",
      ],
      ["pattern", "Glob pattern matching files like: **/*.js, src/**/test/*.ts, and */node_modules/*"],
    ]);

    const tsInterface = convertToTypeScriptInterface(values, "SpecialCharsHelmValues", undefined, comments);
    const code = generateTypeScriptCode(tsInterface, "special-chars");

    expect(code).toMatchSnapshot();
  });
});
