import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.js";
import { z } from "zod";
import { getConfig } from "@shepherdjerred/birmel/config/index.js";
import { loggers } from "@shepherdjerred/birmel/utils/index.js";

const logger = loggers.automation;

export const executeShellCommandTool = createTool({
  id: "execute-shell-command",
  description: `Execute shell commands with Python, Node.js, Bun, or any system command.

**SECURITY WARNING**: This tool executes arbitrary commands in a trusted environment. There are no security restrictions. Only use with trusted ctx.

Examples:
- Execute Python: command="python3", args=["-c", "print('Hello')"]
- Execute Node.js: command="node", args=["-e", "console.log('Hello')"]
- Execute Bun: command="bun", args=["--version"]
- List files: command="ls", args=["-la"]

The tool captures stdout, stderr, exit code, and execution time.`,
  inputSchema: z.object({
    command: z
      .string()
      .describe("Command to execute (e.g., 'python3', 'node', 'bun', 'ls')"),
    args: z.array(z.string()).optional().describe("Command arguments"),
    timeout: z
      .number()
      .optional()
      .describe(
        "Timeout in milliseconds (default: from config, max: from config)",
      ),
    cwd: z
      .string()
      .optional()
      .describe("Working directory (defaults to current directory)"),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe("Environment variables to set"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        stdout: z.string().describe("Standard output"),
        stderr: z.string().describe("Standard error"),
        exitCode: z.number().describe("Process exit code"),
        timedOut: z.boolean().describe("Whether the command timed out"),
        duration: z.number().describe("Execution time in milliseconds"),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    const config = getConfig();

    if (!config.shell.enabled) {
      return {
        success: false,
        message: "Shell tool is disabled in configuration",
      };
    }

    // Determine timeout
    const timeout = ctx.timeout ?? config.shell.defaultTimeout;
    if (timeout > config.shell.maxTimeout) {
      return {
        success: false,
        message: `Timeout ${String(timeout)}ms exceeds maximum allowed timeout ${String(config.shell.maxTimeout)}ms`,
      };
    }

    const startTime = Date.now();
    let timedOut = false;

    // Build command for logging
    const fullCommand = [ctx.command, ...(ctx.args ?? [])].join(" ");
    logger.info(`Executing shell command: ${fullCommand}`, {
      cwd: ctx.cwd,
      timeout,
    });

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout);

      // Execute command using Bun.spawn
      const proc = Bun.spawn({
        cmd: [ctx.command, ...(ctx.args ?? [])],
        ...(ctx.cwd != null && ctx.cwd.length > 0 ? { cwd: ctx.cwd } : {}),
        ...(ctx.env == null ? {} : { env: ctx.env }),
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });

      // Read output with timeout handling
      let stdout = "";
      let stderr = "";
      let exitCode = 0;

      try {
        // Wait for process with timeout
        const result = (await Promise.race([
          proc.exited,
          new Promise((_, reject) => {
            controller.signal.addEventListener("abort", () => {
              proc.kill();
              reject(new Error("Command timed out"));
            });
          }),
        ])) as number;

        exitCode = result;

        // Read stdout and stderr
        const stdoutText = await new Response(proc.stdout).text();
        const stderrText = await new Response(proc.stderr).text();

        stdout = stdoutText;
        stderr = stderrText;
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- timedOut is set by async timeout callback
        if (timedOut) {
          const duration = Date.now() - startTime;
          return {
            success: false,
            message: `Command timed out after ${String(timeout)}ms`,
            data: {
              stdout,
              stderr,
              exitCode: -1,
              timedOut: true,
              duration,
            },
          };
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }

      const duration = Date.now() - startTime;

      // Log result
      logger.info(`Shell command completed`, {
        command: fullCommand,
        exitCode,
        duration,
      });

      // Non-zero exit code is still considered a result (not failure)
      return {
        success: true,
        message:
          exitCode === 0
            ? `Command executed successfully in ${String(duration)}ms`
            : `Command completed with exit code ${String(exitCode)} in ${String(duration)}ms`,
        data: {
          stdout,
          stderr,
          exitCode,
          timedOut: false,
          duration,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Shell command failed`, {
        command: fullCommand,
        error: String(error),
      });

      return {
        success: false,
        message: `Failed to execute command: ${String(error)}`,
        data: {
          stdout: "",
          stderr: String(error),
          exitCode: -1,
          timedOut,
          duration,
        },
      };
    }
  },
});
