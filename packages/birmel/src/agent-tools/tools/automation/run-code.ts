import { createTool } from "@shepherdjerred/birmel/agent-runtime/tools/create-tool.ts";
import {
  RunCodeRequestSchema,
  RunCodeResponseSchema,
  SANDBOX_PORT,
} from "@shepherdjerred/birmel/sandbox/contracts.ts";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";

export const runCodeTool = createTool({
  id: "run-code",
  description:
    "Run a bounded Python, JavaScript, or TypeScript snippet in a disposable credential-free sandbox. The snippet has no network, packages, persistent files, or access to Birmel's environment.",
  inputSchema: RunCodeRequestSchema,
  outputSchema: RunCodeResponseSchema,
  execute: async (input, { signal }) => {
    try {
      const response = await fetch(
        `http://127.0.0.1:${String(SANDBOX_PORT)}/run`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          signal,
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = RunCodeResponseSchema.safeParse(body);
        return parsed.success
          ? parsed.data
          : {
              success: false,
              message: `Sandbox failed with HTTP ${String(response.status)}`,
            };
      }
      return RunCodeResponseSchema.parse(body);
    } catch (error) {
      signal.throwIfAborted();
      return {
        success: false,
        message: `Sandbox unavailable: ${getErrorMessage(error)}`,
      };
    }
  },
});
