import {
  promotionStateSummary,
  type PromotionRunInput,
  type PromotionState,
  type PromotionTarget,
} from "#shared/promotion.ts";
const TOOL_CLIENT = `const endpoint = process.argv[2];
if (!endpoint) throw new Error("Usage: bun browser.ts <endpoint> [JSON body on stdin]");
const raw = ["snapshot","screenshot"].includes(endpoint) ? "" : await Bun.stdin.text();
const request = {endpoint, ...(raw.trim() ? {body:JSON.parse(raw)} : {})};
const socket = process.env.PROMOTION_SOCKET;
if (!socket) throw new Error("PROMOTION_SOCKET missing");
const response = await fetch("http://promotion/tool", {unix:socket, method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)});
const output = await response.text();
if (response.ok && endpoint === "screenshot") {
  const data = JSON.parse(output);
  const imagePath = "browser-"+crypto.randomUUID()+".png";
  await Bun.write(imagePath, Buffer.from(data.png,"base64"));
  console.log(JSON.stringify({path:imagePath}));
} else console.log(output);
if (!response.ok) process.exitCode=1;
`;

const BROWSER_GUIDE = `# Browser connection

Use normal PinchTab navigation, snapshots and actions on the target's persistent profile.
Send a native JSON body on stdin: bun browser.ts <endpoint> < request.json.
Endpoints:
- navigate: {"url":"https://..."}
- snapshot: no body. Returns native compact accessibility text, refs, and timestamps.
- screenshot: no body. Saves a PNG in this workspace and returns its path; open it with your image viewer when visual inspection helps.
- action: native PinchTab body with kind (click, fill, type, select, press, scroll, hover), ref (e.g. e36) or selector, and text/value/key/scrollY/scrollX as appropriate.
- attr: {"selector":"e36","name":"href|type|datetime|disabled|role|name|title|aria-label"}

Use the references from your current snapshot. They address actual inputs inside web components too. Refresh after navigation. The browser reports native HTTP/action failures; inspect the page to understand the result.
For stored credentials, replace literal text with credential:"username" or credential:"password" on a fill or type action using a native ref. Example: {"kind":"type","ref":"e36","credential":"username"}. Fill sets the input value; type clears it and sends native keystrokes, which some controlled forms require to update validation state. The runner supplies the value privately. Then click the observed Log In/Sign In button ref once enabled. No login script chooses the site's controls or sequence for you.

Read-only preview/reconcile blocks form changes and arbitrary clicks. Navigation links and scrolling remain available; preview additionally permits the one stored-credential sign-in. Prepare proposed copy in your final result rather than entering a live submission form.

CAPTCHA helper: bun captcha.ts (no stdin). It solves a supported widget on the current page and applies the response without submitting the page. It is disabled in preview/reconcile. Inspect the page afterward.
Do not call another browser connection or retrieve credentials yourself.
`;

export function promotionTaskFiles(input: {
  target: PromotionTarget;
  state: PromotionState;
  mode: PromotionRunInput["mode"];
  content: string;
  previous: unknown;
}): Record<string, string> {
  return {
    "task.json": JSON.stringify(
      { target: input.target, mode: input.mode },
      null,
      2,
    ),
    "history.json": JSON.stringify(promotionStateSummary(input.state), null, 2),
    "previous-run.json": JSON.stringify(input.previous, null, 2),
    "content.md": input.content,
    "BROWSER.md": BROWSER_GUIDE,
    "browser.ts": TOOL_CLIENT,
    "captcha.ts":
      'const r=await fetch("http://promotion/tool",{unix:process.env.PROMOTION_SOCKET,method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({endpoint:"solve-captcha"})}); console.log(await r.text()); if(!r.ok)process.exitCode=1;\n',
  };
}
