import { describe, test, expect } from "bun:test";
import { sanitizePropertyName } from "./utils.js";
import { convertToTypeScriptInterface } from "./type-converter.js";

describe("Sanitization", () => {
  test("should sanitize reserved keywords", () => {
    const values = {
      default: "value",
      class: "test",
      function: "fn",
    };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties['"default"']).toBeDefined();
    expect(result.properties['"class"']).toBeDefined();
    expect(result.properties['"function"']).toBeDefined();
  });

  test("should sanitize properties with special characters", () => {
    const values = {
      "kebab-case": "value",
      "dot.notation": "value",
      "space name": "value",
    };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties['"kebab-case"']).toBeDefined();
    expect(result.properties['"dot.notation"']).toBeDefined();
    expect(result.properties['"space name"']).toBeDefined();
  });

  test("should handle properties starting with numbers", () => {
    const values = {
      "123start": "value",
    };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties['"123start"']).toBeDefined();
  });

  test("should quote reserved keywords", () => {
    expect(sanitizePropertyName("default")).toBe('"default"');
    expect(sanitizePropertyName("class")).toBe('"class"');
    expect(sanitizePropertyName("function")).toBe('"function"');
  });

  test("should quote properties with special characters", () => {
    expect(sanitizePropertyName("kebab-case")).toBe('"kebab-case"');
    expect(sanitizePropertyName("dot.notation")).toBe('"dot.notation"');
    expect(sanitizePropertyName("space name")).toBe('"space name"');
  });

  test("should not quote normal identifiers", () => {
    expect(sanitizePropertyName("normalProperty")).toBe("normalProperty");
    expect(sanitizePropertyName("camelCase")).toBe("camelCase");
    expect(sanitizePropertyName("snake_case")).toBe("snake_case");
  });
});
