import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { log, setLogLevel } from "./logger.ts";

describe("logger", () => {
  let writeSpy: ReturnType<typeof spyOn>;
  let captured: string;

  beforeEach(() => {
    captured = "";
    writeSpy = spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    });
    setLogLevel("info");
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  test("info messages are shown at info level", () => {
    log.info("hello");
    expect(captured).toContain("hello");
    expect(captured).toContain("[INFO]");
  });

  test("debug messages are hidden at info level", () => {
    log.debug("secret");
    expect(captured).toBe("");
  });

  test("debug messages are shown at debug level", () => {
    setLogLevel("debug");
    log.debug("visible");
    expect(captured).toContain("visible");
    expect(captured).toContain("[DEBUG]");
  });

  test("warn messages are shown at info level", () => {
    log.warn("careful");
    expect(captured).toContain("careful");
    expect(captured).toContain("[WARN]");
  });

  test("error messages are shown at error level", () => {
    setLogLevel("error");
    log.error("bad");
    expect(captured).toContain("bad");
  });

  test("info messages are hidden at error level", () => {
    setLogLevel("error");
    log.info("hidden");
    expect(captured).toBe("");
  });

  test("progress outputs label with counts", () => {
    log.progress(5, 10, "items done");
    expect(captured).toContain("[5/10]");
    expect(captured).toContain("items done");
  });
});
