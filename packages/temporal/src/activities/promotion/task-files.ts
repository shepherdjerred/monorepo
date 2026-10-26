import {
  promotionStateSummary,
  type PromotionRunInput,
  type PromotionState,
  type PromotionTarget,
} from "#shared/promotion.ts";
const TOOL_CLIENT = `const endpoint = process.argv[2];
if (!endpoint) throw new Error("Usage: bun browser.ts <endpoint> [request.json]; stdin bodies are supported only for navigate/action/attr");
const raw = process.argv[3] ? await Bun.file(process.argv[3]).text() : ["snapshot","screenshot"].includes(endpoint) ? "" : await Bun.stdin.text();
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
Pass a native JSON body file: bun browser.ts <endpoint> request.json. For navigate/action/attr, stdin is also supported: bun browser.ts <endpoint> < request.json. Snapshot ignores stdin: always pass its optional scope as a file argument.
Endpoints:
- navigate: {"url":"https://..."}
- snapshot: optional {"selector":"main","depth":3}, either field optional. Returns bounded native accessibility nodes, refs, and timestamps with the browser's untrusted-content notice. For a scoped snapshot, write the body to request.json and use: bun browser.ts snapshot request.json. On large apps, prefer a shallow snapshot to discover regions, then inspect the relevant main/navigation/identity regions separately at full depth. A narrow or depth-limited snapshot is not complete history. Each new snapshot replaces the current refs; refresh the relevant region before using its controls. Wait for each browser command to finish before starting another on the same page.
- screenshot: no body. Saves a PNG in this workspace and returns its path; open it with your image viewer when visual inspection helps.
- action: native PinchTab body with kind (click, fill, type, select, press, scroll, hover), ref (e.g. e36) or selector, and text/value/key/scrollY/scrollX as appropriate.
- attr: {"selector":"e36","name":"href|type|datetime|disabled|role|name|title|aria-label"}

Use the references from your current snapshot. They address actual inputs inside web components too. Refresh after navigation. The browser reports native HTTP/action failures; inspect the page to understand the result.
For stored credentials, replace literal text with credential:"username", credential:"email" (optional saved alternate), or credential:"password" on a fill or type action using a native ref. Choose the identifier the observed form requests. Example: {"kind":"type","ref":"e36","credential":"username"}. Fill sets the input value; type clears it and sends native keystrokes, which some controlled forms require to update validation state. The runner supplies the value privately. Then click the observed Log In/Sign In button ref once enabled. No login script chooses the site's controls or sequence for you.

Read-only preview/reconcile blocks posting form changes and arbitrary clicks. Native search inputs (type=search, role=searchbox, or a combobox explicitly labeled Search) permit typing and Enter for read-only history search. Message/post fields remain blocked. Navigation links and scrolling remain available; preview additionally permits the one stored-credential sign-in. Prepare proposed copy in your final result rather than entering a live submission form.

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
