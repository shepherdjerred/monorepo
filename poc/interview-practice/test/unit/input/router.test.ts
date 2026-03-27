import { describe, test, expect } from "bun:test";

// Test the module exports and types
describe("input router", () => {
  test("exports createTextRouter function", async () => {
    const mod = await import("#lib/input/router.ts");
    expect(mod.createTextRouter).toBeFunction();
  });

  test("exports createVoiceRouter function", async () => {
    const mod = await import("#lib/input/router.ts");
    expect(mod.createVoiceRouter).toBeFunction();
  });

  test("text router has mode 'text'", async () => {
    const { createTextRouter } = await import("#lib/input/router.ts");
    const router = createTextRouter();
    expect(router.mode).toBe("text");
    router.close();
  });

  test("text router has getTextInput and close methods", async () => {
    const { createTextRouter } = await import("#lib/input/router.ts");
    const router = createTextRouter();
    expect(router.getTextInput).toBeFunction();
    expect(router.close).toBeFunction();
    router.close();
  });
});
