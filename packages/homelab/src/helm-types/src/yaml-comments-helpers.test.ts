import { describe, expect, test } from "bun:test";
import {
  isYAMLKey,
  isSimpleYAMLValue,
  isSectionHeader,
  isCodeExample,
  looksLikeProse,
  normalizeCommentLine,
  parseBitnamiParams,
} from "./yaml-comments.ts";

describe("YAML Comment Helper Functions", () => {
  describe("isYAMLKey", () => {
    test("should detect YAML keys without values", () => {
      expect(isYAMLKey("key:")).toBe(true);
      expect(isYAMLKey("my-key:")).toBe(true);
      expect(isYAMLKey("parent.child:")).toBe(true);
    });

    test("should detect YAML keys with pipe operator", () => {
      expect(isYAMLKey("config: |")).toBe(true);
      expect(isYAMLKey("data: |")).toBe(true);
    });

    test("should not detect YAML keys with values", () => {
      // This function specifically looks for keys with | or empty values only
      expect(isYAMLKey("key: value")).toBe(false);
      expect(isYAMLKey("my-key: some value")).toBe(false);
      expect(isYAMLKey("dotted.key: value")).toBe(false);
    });

    test("should not detect non-YAML patterns", () => {
      expect(isYAMLKey("This is a sentence")).toBe(false);
      expect(isYAMLKey("No colon here")).toBe(false);
      expect(isYAMLKey("ref: https://example.com")).toBe(false); // This actually matches, but context matters
      expect(isYAMLKey("- list item")).toBe(false);
    });

    test("should handle edge cases", () => {
      expect(isYAMLKey("")).toBe(false);
      expect(isYAMLKey("   ")).toBe(false);
      expect(isYAMLKey(": no key")).toBe(false);
    });
  });

  describe("isSimpleYAMLValue", () => {
    test("should detect simple key-value pairs", () => {
      expect(isSimpleYAMLValue("name: John")).toBe(true);
      expect(isSimpleYAMLValue("port: 8080")).toBe(true);
      expect(isSimpleYAMLValue("enabled: true")).toBe(true);
    });

    test("should not detect URLs as simple values", () => {
      expect(isSimpleYAMLValue("url: https://example.com")).toBe(false);
      expect(isSimpleYAMLValue("link: http://test.org")).toBe(false);
    });

    test("should not detect ref: patterns", () => {
      expect(isSimpleYAMLValue("ref: some-reference")).toBe(false);
      expect(isSimpleYAMLValue("Ref: another-ref")).toBe(false);
    });

    test("should not detect complex patterns", () => {
      // Note: "config: |" technically matches the simple pattern but is filtered elsewhere
      expect(isSimpleYAMLValue("key:")).toBe(false); // No value after colon
      expect(isSimpleYAMLValue("nested: key: value")).toBe(false); // Multiple colons
    });
  });

  describe("isSectionHeader", () => {
    test("should detect short headers followed by YAML keys", () => {
      expect(isSectionHeader("Redis configuration", "redis:")).toBe(true);
      expect(isSectionHeader("Database settings", "database:")).toBe(true);
    });

    test("should detect config keyword headers", () => {
      expect(isSectionHeader("Advanced configuration options", "advanced.config:")).toBe(true);
      expect(isSectionHeader("Setup parameters", "setup:")).toBe(true);
    });

    test("should not detect sentences as headers", () => {
      expect(isSectionHeader("This is a complete sentence.", "key:")).toBe(false);
      expect(isSectionHeader("Configure the application", "app:")).toBe(false);
      expect(isSectionHeader("The database connection", "db:")).toBe(false);
    });

    test("should not detect headers with URLs", () => {
      expect(isSectionHeader("See https://example.com", "key:")).toBe(false);
    });

    test("should not detect headers when not followed by YAML", () => {
      expect(isSectionHeader("Some header", "This is prose")).toBe(false);
      expect(isSectionHeader("Redis configuration", undefined)).toBe(false);
    });

    test("should not detect ref: as section header", () => {
      expect(isSectionHeader("ref: documentation", "key:")).toBe(false);
    });
  });

  describe("isCodeExample", () => {
    test("should detect YAML keys", () => {
      expect(isCodeExample("key: value", 2)).toBe(true);
      expect(isCodeExample("config: |", 2)).toBe(true);
    });

    test("should detect simple YAML values with low word count", () => {
      expect(isCodeExample("port: 8080", 2)).toBe(true);
      expect(isCodeExample("enabled: true", 2)).toBe(true);
    });

    test("should not detect simple values with high word count", () => {
      expect(isCodeExample("description: this is a long description here", 7)).toBe(false);
    });

    test("should detect YAML lists", () => {
      expect(isCodeExample("- name: test", 3)).toBe(true);
      expect(isCodeExample("- config: |", 3)).toBe(true);
    });

    test("should detect policy rules", () => {
      expect(isCodeExample("p, role, resource, action", 4)).toBe(true);
      expect(isCodeExample("g, user, role", 3)).toBe(true);
    });

    test("should detect indented lines", () => {
      expect(isCodeExample("  indented: value", 2)).toBe(true);
      expect(isCodeExample("    deeper: indent", 2)).toBe(true);
    });

    test("should detect commands", () => {
      expect(isCodeExample("echo 'hello'", 2)).toBe(true);
      expect(isCodeExample("$ARGOCD_TOKEN", 1)).toBe(true);
      expect(isCodeExample("$KUBE_CONFIG", 1)).toBe(true);
    });

    test("should detect separators", () => {
      expect(isCodeExample("---", 1)).toBe(true);
      expect(isCodeExample("-----", 1)).toBe(true);
      expect(isCodeExample("BEGIN CERTIFICATE", 2)).toBe(true);
      expect(isCodeExample("END PRIVATE KEY", 3)).toBe(true);
    });

    test("should detect pipe operator", () => {
      expect(isCodeExample("|", 1)).toBe(true);
    });

    test("should not detect prose", () => {
      expect(isCodeExample("This is a regular sentence", 5)).toBe(false);
      expect(isCodeExample("Configure the application properly", 4)).toBe(false);
    });
  });

  describe("looksLikeProse", () => {
    test("should detect sentences with punctuation", () => {
      expect(looksLikeProse("This is a sentence.", 4)).toBe(true);
      expect(looksLikeProse("Configure the service!", 3)).toBe(true);
      expect(looksLikeProse("Is this working?", 3)).toBe(true);
    });

    test("should detect sentences with colons", () => {
      expect(looksLikeProse("Policy rules are in the form:", 6)).toBe(true);
      expect(looksLikeProse("The options are:", 3)).toBe(true);
    });

    test("should detect sentences with URLs", () => {
      expect(looksLikeProse("See https://example.com for details", 5)).toBe(true);
      expect(looksLikeProse("Reference http://docs.example.org", 3)).toBe(true);
    });

    test("should detect sentences starting with articles", () => {
      expect(looksLikeProse("The database connection string", 4)).toBe(true);
      expect(looksLikeProse("A simple configuration option", 4)).toBe(true);
      expect(looksLikeProse("An alternative approach", 3)).toBe(true);
    });

    test("should detect multi-word sentences starting with capitals", () => {
      expect(looksLikeProse("Redis master configuration parameters", 4)).toBe(true);
      expect(looksLikeProse("Database connection settings", 3)).toBe(true);
    });

    test("should not detect short lines", () => {
      expect(looksLikeProse("Short", 1)).toBe(false);
      expect(looksLikeProse("Too short", 2)).toBe(false);
    });

    test("should not detect YAML keys", () => {
      expect(looksLikeProse("Config:", 1)).toBe(false); // Too short anyway
    });

    test("should not detect lines without capital letters", () => {
      expect(looksLikeProse("this is lowercase", 3)).toBe(false);
      expect(looksLikeProse("no capitals here at all", 5)).toBe(false);
    });
  });

  describe("normalizeCommentLine", () => {
    test("should remove leading # symbols", () => {
      expect(normalizeCommentLine("# Comment")).toBe("Comment");
      expect(normalizeCommentLine("## Comment")).toBe("Comment");
      expect(normalizeCommentLine("### Comment")).toBe("Comment");
    });

    test("should remove -- markers", () => {
      expect(normalizeCommentLine("-- Comment")).toBe("Comment");
      expect(normalizeCommentLine("-- Some text")).toBe("Some text");
    });

    test("should remove @param directives", () => {
      expect(normalizeCommentLine("@param key.path Description text")).toBe("Description text");
      expect(normalizeCommentLine("@param auth.enabled Enable authentication")).toBe("Enable authentication");
    });

    test("should handle combinations", () => {
      expect(normalizeCommentLine("## @param redis.port Redis port number")).toBe("Redis port number");
      expect(normalizeCommentLine("# -- @param db.host Database host")).toBe("Database host");
    });

    test("should trim whitespace", () => {
      expect(normalizeCommentLine("  Comment  ")).toBe("Comment");
      expect(normalizeCommentLine("# Comment  ")).toBe("Comment");
    });

    test("should handle empty strings", () => {
      expect(normalizeCommentLine("")).toBe("");
      expect(normalizeCommentLine("   ")).toBe("");
      expect(normalizeCommentLine("###")).toBe("");
    });

    test("should preserve internal # symbols", () => {
      expect(normalizeCommentLine("# Use #DEBUG for logging")).toBe("Use #DEBUG for logging");
    });
  });

  describe("parseBitnamiParams", () => {
    test("should parse single @param directive", () => {
      const comment = "@param redis.enabled Enable Redis";
      const result = parseBitnamiParams(comment);

      expect(result.params.size).toBe(1);
      expect(result.params.get("redis.enabled")).toBe("Enable Redis");
      expect(result.remainingLines.length).toBe(0);
    });

    test("should parse multiple @param directives", () => {
      const comment = `@param redis.enabled Enable Redis
@param redis.port Redis port number
@param redis.password Redis password`;

      const result = parseBitnamiParams(comment);

      expect(result.params.size).toBe(3);
      expect(result.params.get("redis.enabled")).toBe("Enable Redis");
      expect(result.params.get("redis.port")).toBe("Redis port number");
      expect(result.params.get("redis.password")).toBe("Redis password");
      expect(result.remainingLines.length).toBe(0);
    });

    test("should separate @param directives from prose", () => {
      const comment = `@param auth.enabled Enable authentication
@param auth.password Authentication password

This is additional documentation text
that should be preserved.`;

      const result = parseBitnamiParams(comment);

      expect(result.params.size).toBe(2);
      expect(result.params.get("auth.enabled")).toBe("Enable authentication");
      expect(result.params.get("auth.password")).toBe("Authentication password");
      expect(result.remainingLines.length).toBe(2);
      expect(result.remainingLines[0]).toBe("This is additional documentation text");
      expect(result.remainingLines[1]).toBe("that should be preserved.");
    });

    test("should handle @param with leading markers", () => {
      const comment = `## @param primary.persistence.enabled Enable persistence
## @param primary.persistence.size Storage size`;

      const result = parseBitnamiParams(comment);

      expect(result.params.size).toBe(2);
      expect(result.params.get("primary.persistence.enabled")).toBe("Enable persistence");
      expect(result.params.get("primary.persistence.size")).toBe("Storage size");
    });

    test("should handle empty lines", () => {
      const comment = `@param key1 Description 1

@param key2 Description 2

Some prose text`;

      const result = parseBitnamiParams(comment);

      expect(result.params.size).toBe(2);
      expect(result.params.get("key1")).toBe("Description 1");
      expect(result.params.get("key2")).toBe("Description 2");
      expect(result.remainingLines.length).toBe(1);
      expect(result.remainingLines[0]).toBe("Some prose text");
    });

    test("should handle comments without @param", () => {
      const comment = `This is regular documentation
without any @param directives
just prose text`;

      const result = parseBitnamiParams(comment);

      expect(result.params.size).toBe(0);
      expect(result.remainingLines.length).toBe(3);
      expect(result.remainingLines[0]).toBe("This is regular documentation");
      expect(result.remainingLines[1]).toBe("without any @param directives");
      expect(result.remainingLines[2]).toBe("just prose text");
    });

    test("should handle dotted keys in @param", () => {
      const comment = "@param server.ingress.tls.enabled Enable TLS for ingress";
      const result = parseBitnamiParams(comment);

      expect(result.params.size).toBe(1);
      expect(result.params.get("server.ingress.tls.enabled")).toBe("Enable TLS for ingress");
    });

    test("should ignore malformed @param lines", () => {
      const comment = `@param valid.key Valid description
@param
@param nokey
Some prose`;

      const result = parseBitnamiParams(comment);

      expect(result.params.size).toBe(1);
      expect(result.params.get("valid.key")).toBe("Valid description");
      // Malformed @param lines are treated as text (not extracted as params)
      expect(result.remainingLines.length).toBe(3);
      expect(result.remainingLines[0]).toBe("@param");
      expect(result.remainingLines[1]).toBe("@param nokey");
      expect(result.remainingLines[2]).toBe("Some prose");
    });
  });
});
