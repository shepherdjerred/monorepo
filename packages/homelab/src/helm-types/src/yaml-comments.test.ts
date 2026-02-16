import { describe, test, expect } from "bun:test";
import { parseYAMLComments } from "./yaml-comments.js";

describe("YAML Comment Parsing - Real Helm Chart Examples", () => {
  test("should correctly associate comments with properties at different indent levels (minecraft tty bug)", () => {
    // Real example from minecraft helm chart that was incorrectly associating comments
    const yaml = `    loadBalancerClass:
    loadBalancerIP:
    # loadBalancerSourceRanges: []
    ## Set the externalTrafficPolicy in the Service to either Cluster or Local
    # externalTrafficPolicy: Cluster

  ## set this to false to not have colorized logs
  tty: true

  extraPorts:`;

    const comments = parseYAMLComments(yaml);

    // tty should only get its own comment, not the comments from the deeper nested properties
    expect(comments.get("tty")).toBe("set this to false to not have colorized logs");
    expect(comments.get("tty")).not.toContain("loadBalancerSourceRanges");
    expect(comments.get("tty")).not.toContain("externalTrafficPolicy");
  });

  test("should parse single line comments", () => {
    const yaml = `# This is a comment
key: value`;
    const comments = parseYAMLComments(yaml);
    expect(comments.get("key")).toBe("This is a comment");
  });

  test("should handle multi-line comments", () => {
    const yaml = `# Line 1
# Line 2
# Line 3
key: value`;
    const comments = parseYAMLComments(yaml);
    expect(comments.get("key")).toContain("Line 1");
    expect(comments.get("key")).toContain("Line 2");
    expect(comments.get("key")).toContain("Line 3");
  });

  test("should clean up # and -- markers", () => {
    const yaml = `# -- This is a helm comment
## Another comment
key: value`;
    const comments = parseYAMLComments(yaml);
    expect(comments.get("key")).toBe("This is a helm comment\nAnother comment");
  });

  test("should handle nested keys correctly", () => {
    const yaml = `# Parent comment
parent:
  # Child comment
  child: value`;
    const comments = parseYAMLComments(yaml);
    expect(comments.get("parent")).toBe("Parent comment");
    expect(comments.get("parent.child")).toBe("Child comment");
  });

  test("should handle inline comments", () => {
    const yaml = `key: value  # This is an inline comment`;
    const comments = parseYAMLComments(yaml);
    expect(comments.get("key")).toBe("This is an inline comment");
  });

  test("should not associate deeply nested comments with shallow keys (argo-cd example)", () => {
    const yaml = `server:
  service:
    type: ClusterIP
    port: 80
    # Comment at port level
    targetPort: 8080
    # loadBalancerIP: ""
    # loadBalancerSourceRanges: []

# Top level comment for nextKey
nextKey: value`;

    const comments = parseYAMLComments(yaml);

    // nextKey should only get the top level comment
    expect(comments.get("nextKey")).toBe("Top level comment for nextKey");
    expect(comments.get("nextKey")).not.toContain("loadBalancerIP");
    expect(comments.get("nextKey")).not.toContain("loadBalancerSourceRanges");
  });

  test("should handle multiple nested levels with proper comment association", () => {
    const yaml = `# Level 1 comment
level1:
  # Level 2 comment
  level2:
    # Level 3 comment
    level3: value
    # Another level 3 comment
    another3: value2
  # Back to level 2
  level2b: value3`;

    const comments = parseYAMLComments(yaml);

    expect(comments.get("level1")).toBe("Level 1 comment");
    expect(comments.get("level1.level2")).toBe("Level 2 comment");
    expect(comments.get("level1.level2.level3")).toBe("Level 3 comment");
    expect(comments.get("level1.level2.another3")).toBe("Another level 3 comment");
    expect(comments.get("level1.level2b")).toBe("Back to level 2");
  });

  test("should filter out YAML examples from comments", () => {
    const yaml = `# This is documentation
# hostAliases:
# - ip: "1.2.3.4"
#   hostnames:
#   - "example.com"
# Use this to add host aliases
key: value`;

    const comments = parseYAMLComments(yaml);

    // Should only include prose, not YAML examples
    expect(comments.get("key")).toContain("This is documentation");
    expect(comments.get("key")).toContain("Use this to add host aliases");
    expect(comments.get("key")).not.toContain("hostAliases:");
    expect(comments.get("key")).not.toContain("- ip:");
  });

  test("should filter out policy rules but keep prose from comments", () => {
    const yaml = `policy.csv: ''
# Policy rules are in the form:
# p, subject, resource, action, object, effect
# Role definitions and bindings are in the form:
# g, subject, inherited-subject
# policy.csv: |
# p, role:org-admin, applications, *, */*, allow
# p, role:org-admin, clusters, get, *, allow
# g, your-github-org:your-team, role:org-admin
# OIDC scopes to examine during rbac enforcement (in addition to \`sub\` scope).
# The scope value can be a string, or a list of strings.
scopes: "[groups]"`;

    const comments = parseYAMLComments(yaml);

    // All comments between policy.csv and scopes get associated with scopes
    // This includes both the policy rules explanation AND the OIDC prose
    expect(comments.get("scopes")).toContain("Policy rules are in the form:");
    expect(comments.get("scopes")).toContain("Role definitions and bindings are in the form:");
    expect(comments.get("scopes")).toContain("OIDC scopes to examine");
    expect(comments.get("scopes")).toContain("The scope value can be a string");

    // Should filter out the example rules that could break JSDoc (containing */*)
    expect(comments.get("scopes")).not.toContain("p, role:org-admin");
    expect(comments.get("scopes")).not.toContain("g, your-github-org");
  });

  test("should handle commented-out keys mixed with documentation", () => {
    const yaml = `# Configure the service
# type: LoadBalancer
# ^ Use LoadBalancer for external access
service:
  type: ClusterIP`;

    const comments = parseYAMLComments(yaml);

    expect(comments.get("service")).toContain("Configure the service");
    // The type: LoadBalancer line should be filtered as an example
  });

  test("should handle actual argo-cd scopes field with proper indentation", () => {
    // This is the exact structure from argo-cd values.yaml
    const yaml = `  rbac:
    create: true
    annotations: {}

    policy.default: ''

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
    scopes: "[groups]"`;

    const comments = parseYAMLComments(yaml);

    // Should get the OIDC description
    expect(comments.get("rbac.scopes")).toBeDefined();
    expect(comments.get("rbac.scopes")).toContain("OIDC scopes to examine");
    expect(comments.get("rbac.scopes")).toContain("The scope value can be a string");
  });

  test("should handle keys with dots in their names", () => {
    const yaml = `# Comment for policy.default
policy.default: "role:readonly"
# Comment for policy.csv
policy.csv: ""
# Comment for policy.matchMode
policy.matchMode: "glob"`;

    const comments = parseYAMLComments(yaml);

    expect(comments.get("policy.default")).toBe("Comment for policy.default");
    expect(comments.get("policy.csv")).toBe("Comment for policy.csv");
    expect(comments.get("policy.matchMode")).toBe("Comment for policy.matchMode");
  });

  test("should handle nested keys with dots in names", () => {
    const yaml = `parent:
  # Comment for child.with.dots
  child.with.dots: "value"
  # Comment for another.dotted.key
  another.dotted.key: "value2"`;

    const comments = parseYAMLComments(yaml);

    expect(comments.get("parent.child.with.dots")).toBe("Comment for child.with.dots");
    expect(comments.get("parent.another.dotted.key")).toBe("Comment for another.dotted.key");
  });

  test("should properly resume prose detection after code blocks with backticks and parentheses", () => {
    const yaml = `# First line of prose
# code.example: |
#   some: code
#   another: example
# This is prose with \`backticks\` and (parentheses) that should be included.
# Another line with special chars: colons, dashes - and more.
key: value`;

    const comments = parseYAMLComments(yaml);

    expect(comments.get("key")).toContain("First line of prose");
    expect(comments.get("key")).toContain("This is prose with `backticks` and (parentheses)");
    expect(comments.get("key")).toContain("Another line with special chars");
  });

  test("should handle multiple code blocks with prose in between", () => {
    const yaml = `# Initial documentation
# First code block:
# p, rule1, *, *, allow
# p, rule2, *, *, deny
# Middle documentation explaining something important.
# Second code block:
# g, group1, role1
# g, group2, role2
# Final documentation that wraps it all up.
key: value`;

    const comments = parseYAMLComments(yaml);

    expect(comments.get("key")).toContain("Initial documentation");
    expect(comments.get("key")).toContain("Middle documentation explaining something important");
    expect(comments.get("key")).toContain("Final documentation that wraps it all up");
    expect(comments.get("key")).not.toContain("p, rule1");
    expect(comments.get("key")).not.toContain("g, group1");
  });

  test("should handle empty lines in comments", () => {
    const yaml = `# First paragraph
#
# Second paragraph after empty line
key: value`;

    const comments = parseYAMLComments(yaml);

    expect(comments.get("key")).toContain("First paragraph");
    expect(comments.get("key")).toContain("Second paragraph");
  });

  test("should handle refs and URLs in comments", () => {
    const yaml = `# ref: https://hub.docker.com/r/itzg/minecraft-server/
# For more info see: https://example.com
image: repository`;

    const comments = parseYAMLComments(yaml);

    expect(comments.get("image")).toContain("https://hub.docker.com");
    expect(comments.get("image")).toContain("https://example.com");
  });

  test("should NOT associate section headers from commented-out config blocks with later properties (argo-cd bug)", () => {
    // This is the exact structure from argo-cd values.yaml that caused the bug
    const yaml = `    # Dex configuration
    # dex.config: |
    #   connectors:
    #     # GitHub example
    #     - type: github
    #       id: github
    #       name: GitHub

    # OIDC configuration as an alternative to dex (optional).
    # oidc.config: |
    #   name: AzureAD
    #   issuer: https://login.microsoftonline.com/TENANT_ID/v2.0

    # Extension Configuration
    ## Ref: https://argo-cd.readthedocs.io/en/latest/developer-guide/extensions/proxy-extensions/
    # extension.config: |
    #   extensions:
    #   - name: httpbin

    ## Default configuration for ignoreResourceUpdates.
    ## The ignoreResourceUpdates list contains K8s resource's properties that are known to be frequently updated
    ## by controllers and operators. These resources, when watched by argo, will cause many unnecessary updates.

    # -- Ignoring status for all resources. An update will still be sent if the status update causes the health to change.
    resource.customizations.ignoreResourceUpdates.all: |
      jsonPointers:
        - /status`;

    const comments = parseYAMLComments(yaml);

    // The property should get its actual documentation
    expect(comments.get("resource.customizations.ignoreResourceUpdates.all")).toContain(
      "Default configuration for ignoreResourceUpdates",
    );
    expect(comments.get("resource.customizations.ignoreResourceUpdates.all")).toContain(
      "Ignoring status for all resources",
    );

    // BUT it should NOT include the section headers from commented-out configs
    expect(comments.get("resource.customizations.ignoreResourceUpdates.all")).not.toContain("Dex configuration");
    expect(comments.get("resource.customizations.ignoreResourceUpdates.all")).not.toContain("GitHub example");
    expect(comments.get("resource.customizations.ignoreResourceUpdates.all")).not.toContain("OIDC configuration");
    expect(comments.get("resource.customizations.ignoreResourceUpdates.all")).not.toContain("Extension Configuration");
  });
});
