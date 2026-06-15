import { describe, test, expect } from "bun:test";
import {
  getLanguageConfig,
  getSupportedExtensions,
} from "#lib/testing/languages.ts";

describe("language registry", () => {
  test("supports TypeScript", () => {
    const config = getLanguageConfig(".ts");
    expect(config).toBeDefined();
    expect(config?.compile).toBeNull();
    expect(config?.run).toContain("bun");
  });

  test("supports Java with compile step", () => {
    const config = getLanguageConfig(".java");
    expect(config).toBeDefined();
    expect(config?.compile).toContain("javac");
    expect(config?.run).toContain("java");
  });

  test("supports Python", () => {
    const config = getLanguageConfig(".py");
    expect(config).toBeDefined();
    expect(config?.compile).toBeNull();
    expect(config?.run).toContain("python3");
  });

  test("supports Go", () => {
    const config = getLanguageConfig(".go");
    expect(config).toBeDefined();
    expect(config?.run).toContain("go run");
  });

  test("supports Rust with edition flag", () => {
    const config = getLanguageConfig(".rs");
    expect(config).toBeDefined();
    expect(config?.compile).toContain("edition=2021");
  });

  test("supports C++", () => {
    const config = getLanguageConfig(".cpp");
    expect(config).toBeDefined();
    expect(config?.compile).toContain("g++");
  });

  test("returns undefined for unsupported extensions", () => {
    expect(getLanguageConfig(".rb")).toBeUndefined();
    expect(getLanguageConfig(".swift")).toBeUndefined();
  });

  test("lists all supported extensions", () => {
    const exts = getSupportedExtensions();
    expect(exts).toContain(".ts");
    expect(exts).toContain(".java");
    expect(exts).toContain(".py");
    expect(exts.length).toBeGreaterThanOrEqual(6);
  });
});
