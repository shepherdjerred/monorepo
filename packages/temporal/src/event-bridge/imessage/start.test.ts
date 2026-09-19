import { afterEach, expect, test, vi } from "vitest";
import { startBlueBubblesIngress } from "./start.ts";
import type { Client } from "@temporalio/client";
afterEach(() => vi.unstubAllEnvs());
test("missing bootstrap leaves the connector inactive without changing other ingress", async () => {
  vi.stubEnv("BLUEBUBBLES_URL", "");
  vi.stubEnv("BLUEBUBBLES_PASSWORD", "");
  const start = vi.fn<Client["workflow"]["start"]>();
  await startBlueBubblesIngress({ workflow: { start } });
  expect(start).not.toHaveBeenCalled();
});
test("partial bootstrap fails before admitting a Workflow", async () => {
  vi.stubEnv("BLUEBUBBLES_URL", "http://localhost:1234");
  vi.stubEnv("BLUEBUBBLES_PASSWORD", "");
  const start = vi.fn<Client["workflow"]["start"]>();
  await expect(
    startBlueBubblesIngress({ workflow: { start } }),
  ).rejects.toThrow("both bootstrap URL and password");
  expect(start).not.toHaveBeenCalled();
});
test("admits one stable ingress without placing bootstrap credentials in history", async () => {
  vi.stubEnv("BLUEBUBBLES_URL", "http://localhost:1234");
  vi.stubEnv("BLUEBUBBLES_PASSWORD", "test-secret");
  const start = vi.fn<Client["workflow"]["start"]>();
  await startBlueBubblesIngress({ workflow: { start } });
  expect(start).toHaveBeenCalledWith(
    "blueBubblesIngressWorkflow",
    expect.objectContaining({
      workflowId: "agent-chat-bluebubbles-ingress",
      taskQueue: "monorepo-workflows",
      workflowIdConflictPolicy: "USE_EXISTING",
      workflowIdReusePolicy: "REJECT_DUPLICATE",
      args: [
        {
          startedAt: expect.any(String),
          initialized: false,
          lastRowId: 0,
        },
      ],
    }),
  );
  expect(JSON.stringify(start.mock.calls)).not.toContain("test-secret");
});
