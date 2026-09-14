import { createTool } from "@shepherdjerred/birmel/agent-runtime/tools/create-tool.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { validateSafePublicUrl } from "@shepherdjerred/birmel/utils/safe-url.ts";
import { BrowserInputSchema, BrowserOutputSchema } from "./browser-types.ts";
import {
  forgetMissingPinchtabTab,
  handlePinchtab,
} from "./pinchtab-browser.ts";

const logger = loggers.automation;

export const browserAutomationTool = createTool({
  id: "browser-automation",
  description:
    "Use the shared persistent browser profile to open public HTTPS pages, navigate tabs, read or snapshot content, click, type, press keys, capture screenshots, and close tabs. Cookie values and profile controls are unavailable.",
  inputSchema: BrowserInputSchema,
  outputSchema: BrowserOutputSchema,
  preflight: async (ctx, { signal }) => {
    if (ctx.action === "open" || ctx.action === "navigate") {
      if (ctx.url == null || ctx.url.length === 0) {
        return {
          success: false,
          message: `url is required for ${ctx.action}`,
        };
      }
      try {
        await validateSafePublicUrl(ctx.url, undefined, signal);
      } catch (error) {
        signal.throwIfAborted();
        return { success: false, message: `Failed: ${getErrorMessage(error)}` };
      }
    }
    if (!getConfig().browser.enabled) {
      return { success: false, message: "Browser automation is disabled" };
    }
    return;
  },
  execute: async (ctx, { signal }) => {
    try {
      signal.throwIfAborted();
      return await handlePinchtab(ctx, signal);
    } catch (error) {
      signal.throwIfAborted();
      logger.error("Browser automation failed", {
        action: ctx.action,
        error: getErrorMessage(error),
      });
      return {
        success: false,
        message: `Failed: ${getErrorMessage(error)}`,
        ...(forgetMissingPinchtabTab(ctx, error)
          ? { effectDisposition: "not_applied" as const }
          : {}),
      };
    }
  },
});

export const browserTools = [browserAutomationTool];
