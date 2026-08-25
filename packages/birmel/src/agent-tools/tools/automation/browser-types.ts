import { z } from "zod";

/**
 * The browser-automation tool's input/output contract.
 *
 * Kept apart from `browser.ts` because the PinchTab handler it delegates to
 * consumes these types, and `browser.ts` imports that handler back — an import
 * cycle when the two live together.
 */
export const BrowserInputSchema = z.object({
  action: z
    .enum([
      "start",
      "list-profiles",
      "open",
      "tabs",
      "navigate",
      "snapshot",
      "screenshot",
      "click",
      "type",
      "press",
      "get-text",
      "cookies",
      "close",
    ])
    .describe("The action to perform"),
  profile: z.string().optional().describe("PinchTab profile name"),
  instanceId: z.string().optional().describe("PinchTab instance ID"),
  tabId: z.string().optional().describe("PinchTab tab ID"),
  url: z.string().optional().describe("URL to navigate to (for navigate)"),
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle"])
    .optional()
    .describe("Wait until page event (for navigate)"),
  filename: z
    .string()
    .optional()
    .describe("Screenshot filename (for screenshot)"),
  fullPage: z
    .boolean()
    .optional()
    .describe("Capture full scrollable page (for screenshot)"),
  selector: z
    .string()
    .optional()
    .describe("CSS selector (for click/type/get-text)"),
  text: z.string().optional().describe("Text to type (for type)"),
  pressEnter: z
    .boolean()
    .optional()
    .describe("Press Enter after typing (for type)"),
  timeout: z.number().optional().describe("Timeout in milliseconds"),
  key: z.string().optional().describe("Key to press"),
});

export const BrowserOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      url: z.string().optional(),
      title: z.string().optional(),
      path: z.string().optional(),
      filename: z.string().optional(),
      text: z.string().optional(),
      provider: z.string().optional(),
      instanceId: z.string().optional(),
      tabId: z.string().optional(),
      raw: z.unknown().optional(),
    })
    .optional(),
});

export type BrowserResult = z.output<typeof BrowserOutputSchema>;
export type BrowserContext = Omit<
  z.input<typeof BrowserInputSchema>,
  "action"
> & { action: string };
